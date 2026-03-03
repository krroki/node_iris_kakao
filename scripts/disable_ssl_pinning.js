Java.perform(function() {
  try {
    var X509TrustManager = Java.use('javax.net.ssl.X509TrustManager');
  } catch (e) {}
  try {
    var SSLContext = Java.use('javax.net.ssl.SSLContext');
    var tm = Java.registerClass({
      name: 'com.frida.TrustAllManager',
      implements: [Java.use('javax.net.ssl.X509TrustManager')],
      methods: {
        getAcceptedIssuers: function() { return [] },
        checkClientTrusted: function(chain, authType) {},
        checkServerTrusted: function(chain, authType) {}
      }
    });
    var TrustManager = [ tm.$new() ];
    SSLContext.init.overload('[Ljavax.net.ssl.KeyManager;','[Ljavax.net.ssl.TrustManager;','java.security.SecureRandom').implementation = function(km, tmr, sr) {
      console.log('[ssl] SSLContext.init override');
      return this.init(km, TrustManager, sr);
    };
  } catch (e) { console.log('[ssl][skip] SSLContext: '+e) }
  try {
    var HostnameVerifier = Java.use('javax.net.ssl.HostnameVerifier');
    var HV = Java.registerClass({
      name: 'com.frida.TrustAllHostname',
      implements: [HostnameVerifier],
      methods: { verify: function(hostname, session) { return true; } }
    });
    var HttpsURLConnection = Java.use('javax.net.ssl.HttpsURLConnection');
    HttpsURLConnection.setDefaultHostnameVerifier.overload('javax.net.ssl.HostnameVerifier').implementation = function(v){ console.log('[ssl] setDefaultHostnameVerifier'); return this.setDefaultHostnameVerifier(HV.$new()); };
  } catch (e) { console.log('[ssl][skip] HostnameVerifier: '+e) }
  try {
    var CertPinner = Java.use('okhttp3.CertificatePinner');
    CertPinner.check.overload('java.lang.String','java.util.List').implementation = function(a,b){ console.log('[ssl] CertificatePinner.check bypass'); return; };
  } catch (e) { console.log('[ssl][skip] CertificatePinner: '+e) }
});
