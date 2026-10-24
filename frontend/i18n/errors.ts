import type { MessageKey } from "./messages";

// Translate presentation only. Backend payloads and stored check results stay untouched.
export function errorKey(
  message: string,
  kind: "request" | "check" = "request",
): MessageKey {
  const exact: Record<string, MessageKey> = {
    "pulsewatch:network": "networkError",
    "pulsewatch:validation": "validationError",
    "pulsewatch:url": "urlError",
    "pulsewatch:request": "requestError",
    "Monitor not found.": "notFoundError",
    "A check is already running for this monitor.": "busyError",
    "Check queue is full. Try again shortly.": "queueError",
    "Use a public HTTP or HTTPS URL without credentials or fragments.":
      "urlError",
    "A name (1–100 characters) and URL (up to 2048 characters) are required.":
      "validationError",
    "Provide valid JSON and a numeric monitor ID.": "malformedError",
    "Unable to complete the request. Check the backend logs.": "serverError",
    "Invalid request.": "malformedError",
    "Destination is not a public address": "privateError",
    "No DNS addresses": "dnsError",
    "DNS resolver is busy. Try again shortly.": "dnsBusyError",
    "Check interrupted": "interruptedError",
    "Too many redirects": "redirectError",
    "HTTP headers exceed 32 KB": "headersError",
    "Incomplete HTTP headers": "responseError",
    "Invalid HTTP response": "responseError",
    "Invalid HTTP status": "responseError",
  };
  if (Object.prototype.hasOwnProperty.call(exact, message)) return exact[message];
  if (/timeout|timed out|deadline/i.test(message)) return "timeoutError";
  if (
    /SSL|TLS|certificate|certification path|PKIX|handshake|subject alternative|peer not authenticated/i.test(
      message,
    )
  )
    return "tlsError";
  if (
    /UnknownHost|name or service not known|nodename nor servname|no such host|resolve|DNS/i.test(
      message,
    )
  )
    return "dnsError";
  if (
    /connect|refused|unreachable|reset|broken pipe|socket closed/i.test(message)
  )
    return "connectionError";
  return kind === "check" ? "checkError" : "requestError";
}
