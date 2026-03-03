Java.perform(function () {
  console.log("[list] enumerate classes containing 'okhttp' or 'OkHttp'");
  Java.enumerateLoadedClasses({
    onMatch: function (c) {
      try {
        if (c.indexOf('okhttp') >= 0 || c.indexOf('OkHttp') >= 0) {
          console.log(c);
        }
      } catch (e) {}
    },
    onComplete: function () { console.log("[list] done"); }
  });
});
