"""HTTP connections pinned to an already validated public address."""
import http.client
import ipaddress
import socket
import ssl
from urllib.parse import urlsplit


def pinned_public_connection(url: str, timeout: float = 15):
    parsed = urlsplit(url)
    hostname = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    resolved = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    addresses = list(dict.fromkeys(entry[4][0].split("%", 1)[0] for entry in resolved))
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("Dawnstudy can only open public websites.")
    address = addresses[0]
    if parsed.scheme == "https":
        connection = http.client.HTTPSConnection(hostname, port, timeout=timeout, context=ssl.create_default_context())
    else:
        connection = http.client.HTTPConnection(hostname, port, timeout=timeout)
    # HTTPConnection uses this factory for its TCP socket. TLS still verifies
    # hostname/SNI normally, while the TCP destination never resolves DNS again.
    connection._create_connection = lambda _target, timeout, source_address=None: socket.create_connection((address, port), timeout, source_address)
    return connection
