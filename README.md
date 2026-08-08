```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
```

## Команди запуску

### 1. HTTP-сервер

```bash
node src/server.js
```

### 2. HTTPS-сервер

```bash
node src/https-server.js
```

---

## Дебаг-сесія

```bash
openssl s_client -connect localhost:3443 -servername localhost
```

### Результат виконання:

```text
Connecting to ::1
depth=0 CN=localhost
verify error:num=18:self-signed certificate
verify return:1
depth=0 CN=localhost
verify return:1
CONNECTED(00000006)
---
Certificate chain
 0 s:CN=localhost
   i:CN=localhost
   a:PKEY: RSA, 2048 (bit); sigalg: sha256WithRSAEncryption
   v:NotBefore: Aug  8 18:03:40 2026 GMT; NotAfter: Aug  8 18:03:40 2027 GMT
---
Server certificate
-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUJKpaRznus6LZnGyOqL9fOelB5EcwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDgwODE4MDM0MFoXDTI3MDgw
ODE4MDM0MFowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAzGZ5pJPzFsuRN6VLz4wTp0E0I3PkJEPqRLI2VkzM5hyL
nfVjI8xYoOQ826IzR7kvnv89y9he3B+6FKwPpUHaRKUR4YsXtYfH9XpaRg4Ymhjp
RWrfclsyqMIeD68Q0qxxhbCnTT3pa6w7oRPy9ZUpJWd0X4BfDvx7dlze5DO/6Tb2
W1Aa5/cpcGp0Pbi9KGvkmKx6WsAz1lNRpT0jNUU4rtnoq049Om9I/e8pqVQ9zteD
59Ti+0Ec+TcqIMyZWIzDI6xB/8oSNfYzquGT5egVSSbRYFVi2ayLDQVie31o4VXA
9QAjYPcdyZ1ITidshX579lXG1cbb4JT0szlBfGGvIQIDAQABo1MwUTAdBgNVHQ4E
FgQUaB+OsybzCCg/9U0/R/b01sw1JVQwHwYDVR0jBBgwFoAUaB+OsybzCCg/9U0/
R/b01sw1JVQwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAyZrC
a76kYTY0kpm2iaIX8xu/ewUPIAajwGXHHoB8PRH9rW97rRiQbiqA0VBEhEZ4YUtk
2kpn3FmgnTTKsVe1yLYiq0ghQ2SStk668pBl0kUbo/COU9jgeARJE84bSHCeGvtQ
SlQjKSvMms47P6OlHIta7bqASNJ3N2zwxuiYQu38SCR/jm5TqOJ/U5wQTa7bLllA
bR0LOiaZ5eRqzGyuw6ZYUyT0WboVrd1Dv+sMUpr8VRn/4wL70QJKZX55ZWwWTyzi
i/DoWjcpIZ/3gG3+c+zAUjd4YdZbLSK00czZlRBXZoR4clCRasnwmnQols/hnkhh
a2m/PPUCUgalJiJvGw==
-----END CERTIFICATE-----
subject=CN=localhost
issuer=CN=localhost
---
No client certificate CA names sent
Peer signing digest: SHA256
Peer signature type: rsa_pss_rsae_sha256
Negotiated TLS1.3 group: X25519MLKEM768
---
SSL handshake has read 2425 bytes and written 1620 bytes
Verification error: self-signed certificate
---
New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384
Protocol: TLSv1.3
Server public key is 2048 bit
This TLS version forbids renegotiation.
Compression: NONE
Expansion: NONE
No ALPN negotiated
Early data was not sent
Verify return code: 18 (self-signed certificate)
---
DONE
```

### Пояснення помилки валідації сертифіката (Verify return code: 18):

Код помилки `18` (`self-signed certificate`) свідчить про те, що пред'явлений сертифікат підписаний самим собою і його немає в ланцюжку довіри жодного публічного центру сертифікації (CA), що є стандартною та очікуваною поведінкою під час використання локальних сертифікатів розробника.
