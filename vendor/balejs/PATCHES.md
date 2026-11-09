# Vendored Bale client library

`vendor/balejs` is a copy of [`@hoseinbnoob/balejs` 0.1.0](https://github.com/Zellias/balejs)
(MIT, see `LICENSE`).

It is vendored so dibaMCP can carry one compatibility patch:

- **Node.js 24+**: `dist/core/grpc.js` no longer calls `http2Session.socket.setNoDelay(true)`.
  Accessing `ClientHttp2Session.socket` throws `ERR_HTTP2_NO_SOCKET_MANIPULATION` on Node 24.
  Node's HTTP/2 implementation manages the socket itself.

When updating the library, re-apply this patch and keep the `.proto` files in `dist/proto`.
