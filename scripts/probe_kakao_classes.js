Java.perform(function(){
  var classes = Java.enumerateLoadedClassesSync();
  var hits = [];
  classes.forEach(function(c){
    var l = c.toLowerCase();
    if (l.indexOf('kakao')>=0 && (l.indexOf('token')>=0 || l.indexOf('auth')>=0)) hits.push(c);
  });
  hits.sort();
  console.log('[probe] classes=' + hits.length);
  hits.slice(0,400).forEach(function(c){ console.log(c); });
});
