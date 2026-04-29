// tpl — requirejs template plugin compatible with requirejs-tpl-dawsontoth.
// Loads an HTML file via the 'text' plugin and compiles it with _.template.
// Config: require.config({ config: { tpl: { variable: 'D' } } })
define(['text', 'underscore'], function(text, _) {
  var buildMap = {};

  return {
    load: function(name, req, onLoad, config) {
      if (config.isBuild) { onLoad(); return; }
      var url = req.toUrl(name);
      var tplConfig = (config.config && config.config.tpl) || {};
      text.get(url, function(templateText) {
        // Underscore 1.5.x API: _.template(text, data, settings)
        // Pass null as data so the template is compiled, not immediately rendered.
        var compiled = _.template(templateText, null, tplConfig);
        buildMap[name] = compiled;
        onLoad(compiled);
      }, function(err) {
        onLoad.error(err);
      });
    },

    write: function(pluginName, name, write) {
      if (buildMap.hasOwnProperty(name)) {
        write.asModule(pluginName + '!' + name,
          'define(function(){ return ' + buildMap[name].source + '; });\n');
      }
    }
  };
});
