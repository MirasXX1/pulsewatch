package dev.pulsewatch;

import java.net.*;
import java.util.*;
import org.springframework.stereotype.Component;

@Component
public class UrlPolicy {
    private static final Set<String> SCHEMES = Set.of("http", "https");
    private static final List<Network> BLOCKED = List.of(
            // IPv4 special-use ranges, including shared, documentation and service networks.
            network("0.0.0.0/8"), network("10.0.0.0/8"), network("100.64.0.0/10"),
            network("127.0.0.0/8"), network("169.254.0.0/16"), network("172.16.0.0/12"),
            network("192.0.0.0/24"), network("192.0.2.0/24"), network("192.31.196.0/24"),
            network("192.52.193.0/24"), network("192.88.99.0/24"), network("192.168.0.0/16"),
            network("192.175.48.0/24"), network("198.18.0.0/15"), network("198.51.100.0/24"),
            network("203.0.113.0/24"), network("224.0.0.0/4"), network("240.0.0.0/4"),
            // IPv6 protocol assignments, documentation, transition and service networks.
            network("2001::/23"), network("2001:db8::/32"), network("2002::/16"),
            network("2620:4f:8000::/48"), network("3fff::/20"));
    private static final Network GLOBAL_V6 = network("2000::/3");

    public URI parse(String value) {
        try {
            URI uri = new URI(value.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!SCHEMES.contains(scheme) || uri.getHost() == null || uri.getUserInfo() != null
                    || uri.getFragment() != null || uri.getPort() == 0 || uri.getPort() > 65535) {
                throw new IllegalArgumentException();
            }
            String host = uri.getHost().toLowerCase(Locale.ROOT).replaceFirst("[.]$", "");
            if (host.equals("localhost") || host.endsWith(".localhost") || host.endsWith(".local")
                    || host.endsWith(".internal") || host.contains("%")) {
                throw new IllegalArgumentException();
            }
            // Numeric literals are checked without resolving a hostname in the API thread.
            if ((host.contains(":") || host.matches("[0-9.]+")) && !isPublic(InetAddress.getByName(host))) {
                throw new IllegalArgumentException();
            }
            return new URI(scheme + uri.toASCIIString().substring(uri.getScheme().length()));
        } catch (Exception exception) {
            throw new IllegalArgumentException("Use a public HTTP or HTTPS URL without credentials or fragments.");
        }
    }

    public InetAddress[] resolve(URI uri) throws UnknownHostException {
        InetAddress[] addresses = lookup(uri.getHost());
        if (addresses.length == 0) throw new UnknownHostException("No DNS addresses");
        for (InetAddress address : addresses) {
            if (!isPublic(address)) throw new UnknownHostException("Destination is not a public address");
        }
        return addresses;
    }

    protected InetAddress[] lookup(String host) throws UnknownHostException {
        return InetAddress.getAllByName(host);
    }

    public boolean isPublic(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                || address.isSiteLocalAddress() || address.isMulticastAddress()) return false;
        byte[] bytes = address.getAddress();
        if (bytes.length == 16 && !GLOBAL_V6.contains(bytes)) return false;
        return BLOCKED.stream().noneMatch(network -> network.contains(bytes));
    }

    private record Network(byte[] address, int prefix) {
        boolean contains(byte[] candidate) {
            if (candidate.length != address.length) return false;
            for (int bit = 0; bit < prefix; bit++) {
                int mask = 1 << (7 - bit % 8);
                if ((candidate[bit / 8] & mask) != (address[bit / 8] & mask)) return false;
            }
            return true;
        }
    }

    private static Network network(String cidr) {
        String[] parts = cidr.split("/");
        try {
            return new Network(InetAddress.getByName(parts[0]).getAddress(), Integer.parseInt(parts[1]));
        } catch (UnknownHostException exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }
}
