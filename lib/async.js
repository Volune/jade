/*!
 * Jade
 * Copyright(c) 2010 TJ Holowaychuk <tj@vision-media.ca>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var Parser = require('./parser')
  , Lexer = require('./lexer')
  , Compiler = require('./compiler')
  , runtime = require('./runtime')
  , addWith = require('with')
  , fs = require('fs');

/**
 * Parse the given `str` of jade and return a function body.
 *
 * @param {String} str
 * @param {Object} options
 * @param {Function} callback
 * @api private
 */

function parse(str, options, callback){
  try {
    // Parse
    var parser = new (options.parser || Parser)(str, options.filename, options);

    // Compile
    var compiler = new (options.compiler || Compiler)(parser.parse(), options);

  } catch (ex) {
    ex.context = parser.context();
    callback(ex);
    return;
  }

  compiler.compile(function(err, js){
    if (err)
      callback(err);
    else {

      try {
        // Debug compiler
        if (options.debug) {
          console.error('\nCompiled Function:\n\n\033[90m%s\033[0m', js.replace(/^/gm, '  '));
        }

        var globals = options.globals && Array.isArray(options.globals) ? options.globals : [];

        globals.push('jade');
        globals.push('jade_debug');
        globals.push('buf');

        callback(null, ''
          + 'var buf = [];\n'
          + (options.self
          ? 'var self = locals || {};\n' + js
          : addWith('locals || {}', js, globals)) + ';'
          + 'return buf.join("");');
      } catch (ex) {
        ex.context = parser.context();
        callback(ex)
      }

    }
  });
}

/**
 * Compile a `Function` representation of the given jade `str`.
 *
 * Options:
 *
 *   - `compileDebug` when `false` debugging code is stripped from the compiled
 template, when it is explicitly `true`, the source code is included in
 the compiled template for better accuracy.
 *   - `filename` used to improve errors when `compileDebug` is not `false`
 *
 * @param {String} str
 * @param {Object|Function} options or callback
 * @param {Function|undefined} callback
 * @api public
 */

exports.compile = function(str, options, callback){
  if ('function' == typeof options) {
    callback = options;
    options = undefined;
  }

  options = options || {};

  var filename = options.filename
      ? JSON.stringify(options.filename)
      : 'undefined'
    ;

  str = String(str);

  parse(str, options, function(err, fn){
    if (err) {
      callback(err);
      return;
    }

    if (options.compileDebug !== false) {
      fn = [
        'var jade_debug = [{ lineno: 1, filename: ' + filename + ' }];'
        , 'try {'
        , fn
        , '} catch (err) {'
        , '  jade.rethrow(err, jade_debug[0].filename, jade_debug[0].lineno' + (options.compileDebug === true ? ',' + JSON.stringify(str) : '') + ');'
        , '}'
      ].join('\n');
    }

    if (options.client)
      callback(null, new Function('locals', fn));
    else {
      fn = new Function('locals, jade', fn);
      callback(null, function(locals){ return fn(locals, Object.create(runtime)) });
    }
  });
};

/**
 * Render the given `str` of jade.
 *
 * Options:
 *
 *   - `cache` enable template caching
 *   - `filename` filename required for `include` / `extends` and caching
 *
 * @param {String} str
 * @param {Object|Function} options or callback
 * @param {Function|undefined} callback
 * @api public
 */

exports.render = function(str, options, callback){
  if ('function' == typeof options) {
    callback = options;
    options = undefined;
  }

  options = options || {};

  // cache requires .filename
  if (options.cache && !options.filename) {
    callback(new Error('the "filename" option is required for caching'));
    return;
  }

  var path = options.filename;
  if (options.cache && exports.cache[path]) {
    callback(null, exports.cache[path](options));
  } else {
    exports.compile(str, options, function(err, tmpl){
      if (err)
        callback(err);
      else {
        if (options.cache)
          exports.cache[path] = tmpl;
        callback(null, tmpl(options));
      }
    });
  }
};

/**
 * Render a Jade file at the given `path`.
 *
 * @param {String} path
 * @param {Object|Function} options or callback
 * @param {Function|undefined} callback
 * @api public
 */

exports.renderFile = function(path, options, callback){
  if ('function' == typeof options) {
    callback = options;
    options = undefined;
  }

  options = options || {};

  var key = path + ':string';

  options.filename = path;
  if (options.cache && exports.cache[key]) {
    exports.render(exports.cache[key], options, callback);
  } else {
    fs.readFile(path, 'utf8', function(err, str){
      if (err)
        callback(err);
      else {
        if (options.cache)
          exports.cache[key] = str;
        exports.render(str, options, callback);
      }
    });
  }
};

/**
 * Express support.
 */

exports.__express = exports.renderFile;
