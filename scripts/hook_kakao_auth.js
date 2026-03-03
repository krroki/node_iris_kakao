Java.perform(function () {
  function logAuth(prefix, name, value) {
    try {
      const key = String(name || '').toLowerCase();
      if (key === 'authorization') {
        const val = String(value || '');
        if (val.length) {
          console.log('[AUTH]', prefix, '=> Authorization: ' + val);
        }
      } else if (!name && typeof value === 'string' && value.toLowerCase().indexOf('authorization:') === 0) {
        const parts = value.split(/:\s*/i);
        if (parts.length >= 2) {
          console.log('[AUTH]', prefix, '=> ' + value.trim());
        }
      }
    } catch (e) {}
  }

  function safeCall(fn) {
    try { fn(); } catch (e) {}
  }

  // okhttp3.Headers$Builder.add variants
  safeCall(function () {
    const HB = Java.use('okhttp3.Headers$Builder');
    HB.add.overload('java.lang.String', 'java.lang.String').implementation = function (name, value) {
      logAuth('Headers.Builder.add(name,value)', name, value);
      return this.add(name, value);
    };
    HB.add.overload('java.lang.String').implementation = function (line) {
      logAuth('Headers.Builder.add(line)', null, line);
      return this.add(line);
    };
    if (HB.addLenient) {
      safeCall(function () {
        HB.addLenient.overload('java.lang.String', 'java.lang.String').implementation = function (name, value) {
          logAuth('Headers.Builder.addLenient(name,value)', name, value);
          return this.addLenient(name, value);
        };
      });
      safeCall(function () {
        HB.addLenient.overload('java.lang.String').implementation = function (line) {
          logAuth('Headers.Builder.addLenient(line)', null, line);
          return this.addLenient(line);
        };
      });
    }
    if (HB.addUnsafeNonAscii) {
      safeCall(function () {
        HB.addUnsafeNonAscii.overload('java.lang.String', 'java.lang.String').implementation = function (name, value) {
          logAuth('Headers.Builder.addUnsafeNonAscii', name, value);
          return this.addUnsafeNonAscii(name, value);
        };
      });
    }
  });

  // okhttp3.Request$Builder variants
  safeCall(function () {
    const RB = Java.use('okhttp3.Request$Builder');
    RB.addHeader.overload('java.lang.String', 'java.lang.String').implementation = function (name, value) {
      logAuth('Request.addHeader', name, value);
      return this.addHeader(name, value);
    };
    RB.header.overload('java.lang.String', 'java.lang.String').implementation = function (name, value) {
      logAuth('Request.header', name, value);
      return this.header(name, value);
    };
    if (RB.headers.overload('okhttp3.Headers')) {
      RB.headers.overload('okhttp3.Headers').implementation = function (headers) {
        try {
          const auth = headers.get('Authorization');
          if (auth) {
            logAuth('Request.headers(Headers)', 'Authorization', auth);
          }
        } catch (e) {}
        return this.headers(headers);
      };
    }
    RB.build.implementation = function () {
      const req = this.build();
      try {
        const headers = req.headers();
        const auth = headers.get('Authorization');
        if (auth) {
          logAuth('Request.build.headers', 'Authorization', auth);
        }
      } catch (e) {}
      return req;
    };
  });

  // okhttp3.Headers.get
  safeCall(function () {
    const H = Java.use('okhttp3.Headers');
    H.get.overload('java.lang.String').implementation = function (name) {
      const value = this.get(name);
      logAuth('Headers.get', name, value);
      return value;
    };
  });

  // Interceptor chain (catch-all)
  safeCall(function () {
    const Chain = Java.use('okhttp3.internal.http.RealInterceptorChain');
    Chain.proceed.overload('okhttp3.Request').implementation = function (request) {
      try {
        const headers = request.headers();
        const auth = headers.get('Authorization');
        if (auth) {
          logAuth('RealInterceptorChain.proceed', 'Authorization', auth);
        }
      } catch (e) {}
      return this.proceed(request);
    };
  });

  // HttpURLConnection
  safeCall(function () {
    const HttpURLConnection = Java.use('java.net.HttpURLConnection');
    HttpURLConnection.setRequestProperty.overload('java.lang.String', 'java.lang.String').implementation = function (name, value) {
      logAuth('HttpURLConnection.setRequestProperty', name, value);
      return this.setRequestProperty(name, value);
    };
    HttpURLConnection.addRequestProperty.overload('java.lang.String', 'java.lang.String').implementation = function (name, value) {
      logAuth('HttpURLConnection.addRequestProperty', name, value);
      return this.addRequestProperty(name, value);
    };
  });

  console.log('[hook] Authorization monitor (extended) installed');
});
