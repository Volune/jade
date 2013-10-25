/*!
 * Jade - filters
 * Copyright(c) 2010 TJ Holowaychuk <tj@vision-media.ca>
 * MIT Licensed
 */

var transformers = require('transformers');

module.exports = filter;
function filter(name, str, options){
  if (typeof filter[name] === 'function') {
    var res = filter[name](str, options);
  } else if (transformers[name]) {
    var res = transformers[name].renderSync(str, options);
    if (transformers[name].outputFormat === 'js') {
      res = '<script type="text/javascript">\n' + res + '</script>';
    } else if (transformers[name].outputFormat === 'css') {
      res = '<style type="text/css">' + res + '</style>';
    } else if (transformers[name].outputFormat === 'xml') {
      res = res.replace(/'/g, '&#39;');
    }
  } else {
    throw new Error('unknown filter ":' + name + '"');
  }
  return res;
}
filter.exists = function(name, str, options){
  return typeof filter[name] === 'function' || transformers[name];
};

module.exports.async = filterAsync;
function filterAsync(name, str, options, callback){
  if (typeof filterAsync[name] === 'function') {
    filterAsync[name](str, options, callback);
  } else if (typeof filter[name] === 'function') {
    var res;
    try {
      res = filter[name](str, options);
    } catch (ex) {
      callback(ex);
      return;
    }
    callback(null, res);
  } else if (transformers[name]) {
    var transformer = transformers[name];
    transformer.render(str, options, function(err, res){
      if (err)
        callback(err);
      else {
        if (transformer.outputFormat === 'js') {
          res = '<script type="text/javascript">\n' + res + '</script>';
        } else if (transformer.outputFormat === 'css') {
          res = '<style type="text/css">' + res + '</style>';
        } else if (transformer.outputFormat === 'xml') {
          res = res.replace(/'/g, '&#39;');
        }
        callback(null, res);
      }
    });
  } else {
    callback(new Error('unknown filter ":' + name + '"'));
  }
}
filterAsync.exists = function(name, str, options){
  return typeof filterAsync[name] === 'function'
    || typeof filter[name] === 'function'
    || transformers[name];
};
