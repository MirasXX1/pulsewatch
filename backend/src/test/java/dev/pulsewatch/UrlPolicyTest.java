package dev.pulsewatch;
import java.net.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;
class UrlPolicyTest {
 private final UrlPolicy policy=new UrlPolicy();
 @ParameterizedTest @ValueSource(strings={"file:///etc/passwd","ftp://example.com","http://user:password@example.com","http://localhost","https://api.localhost","http://metadata.internal","http://printer.local","http://127.0.0.1","http://127.1","http://2130706433","http://10.0.0.1","http://[::1]","http://[::ffff:127.0.0.1]","http://example.com:0","https://example.com/#fragment","https://example.com:65536","http://example.com/\r\nHost:evil","http:///missing"})
 void rejectsUnsafeUrls(String input){assertThrows(IllegalArgumentException.class,()->policy.parse(input));}
 @ParameterizedTest @ValueSource(strings={"0.0.0.0","10.2.3.4","127.1.2.3","169.254.169.254","172.16.0.1","172.31.255.255","192.168.1.1","100.64.0.1","100.127.255.254","192.0.0.1","192.0.2.1","192.88.99.1","192.31.196.1","192.52.193.1","192.175.48.1","198.18.0.1","198.19.0.1","198.51.100.1","203.0.113.1","224.0.0.1","255.255.255.255","::","::1","fc00::1","fd00::1","fe80::1","ff02::1","::ffff:10.1.2.3","64:ff9b::a00:1","2001:db8::1","2001::1","2002:0808:0808::1","3fff::1","2620:4f:8000::1"})
 void blocksSpecialAddresses(String address)throws Exception{assertFalse(policy.isPublic(InetAddress.getByName(address)),address);}
 @ParameterizedTest @ValueSource(strings={"8.8.8.8","1.1.1.1","93.184.216.34","198.51.1.1","2606:4700:4700::1111","2001:4860:4860::8888"})
 void allowsPublicAddresses(String address)throws Exception{assertTrue(policy.isPublic(InetAddress.getByName(address)));}
 @Test void validatesEveryDnsAnswer()throws Exception{
  UrlPolicy mixed=new UrlPolicy(){@Override protected InetAddress[] lookup(String host)throws UnknownHostException{return new InetAddress[]{InetAddress.getByName("8.8.8.8"),InetAddress.getByName("127.0.0.1")};}};
  assertThrows(UnknownHostException.class,()->mixed.resolve(policy.parse("https://example.com")));
 }
 @Test void resolvesAgainForEachCheck()throws Exception{
  UrlPolicy rebinding=new UrlPolicy(){int calls;@Override protected InetAddress[] lookup(String host)throws UnknownHostException{return new InetAddress[]{InetAddress.getByName(calls++==0?"8.8.8.8":"10.0.0.1")};}};
  URI uri=policy.parse("https://example.com");assertEquals("8.8.8.8",rebinding.resolve(uri)[0].getHostAddress());assertThrows(UnknownHostException.class,()->rebinding.resolve(uri));
 }
 @Test void acceptsSchemeCase(){assertEquals("https://example.com",policy.parse("HTTPS://example.com").toString());}
 @Test void preservesPathAndQuery(){assertEquals("https://example.com/a?q=1",policy.parse(" https://example.com/a?q=1 ").toString());}
}
