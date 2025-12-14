Java.perform(function () {
  var prefix = 'okhttp3.';
  console.log('[dump] listing methods under ' + prefix);
  Java.enumerateLoadedClasses({
    onMatch: function (c) {
      try {
        if (c.indexOf(prefix) === 0) {
          var Cls = Java.use(c);
          var methods = Cls.class.getDeclaredMethods();
          for (var i = 0; i < methods.length; i++) {
            console.log(c + '::' + methods[i].toString());
          }
        }
      } catch (e) {}
    },
    onComplete: function () { console.log('[dump] done'); }
  });
});
