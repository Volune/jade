/*!
 * Jade - Compiler
 * Copyright(c) 2010 TJ Holowaychuk <tj@vision-media.ca>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var nodes = require('./nodes')
  , filters = require('./filters')
  , doctypes = require('./doctypes')
  , selfClosing = require('./self-closing')
  , runtime = require('./runtime')
  , utils = require('./utils')
  , parseJSExpression = require('character-parser').parseMax
  , isConstant = require('constantinople')
  , toConstant = require('constantinople').toConstant


/**
 * Initialize `Compiler` with the given `node`.
 *
 * @param {Node} node
 * @param {Object} options
 * @api public
 */

var Compiler = module.exports = function Compiler(node, options){
  this.options = options = options || {};
  this.node = node;
  this.hasCompiledDoctype = false;
  this.hasCompiledTag = false;
  this.pp = options.pretty || false;
  this.debug = false !== options.compileDebug;
  this.inMixin = false;
  this.indents = 0;
  this.parentIndents = 0;
  if (options.doctype) this.setDoctype(options.doctype);
};

/**
 * Compiler prototype.
 */

Compiler.prototype = {

  /**
   * Compile parse tree to JavaScript. Synchronous without callback parameter, Asynchronous with callback parameter.
   *
   * @param {Function|undefined} callback
   * @api public
   */

  compile: function(callback){
    this.buf = [];
    if (this.pp) this.buf.push("jade.indent = [];");
    this.lastBufferedIdx = -1;
    if (callback) {
      var that = this;
      this.visit(this.node, function(err){
        if (err)
          callback(err);
        else
          callback(null, that.buf.join('\n'));
      });
      return null;
    } else {
      this.visit(this.node);
      return this.buf.join('\n');
    }
  },

  /**
   * Sets the default doctype `name`. Sets terse mode to `true` when
   * html 5 is used, causing self-closing tags to end with ">" vs "/>",
   * and boolean attributes are not mirrored.
   *
   * @param {string} name
   * @api public
   */

  setDoctype: function(name){
    name = name || 'default';
    this.doctype = doctypes[name.toLowerCase()] || '<!DOCTYPE ' + name + '>';
    this.terse = this.doctype.toLowerCase() == '<!doctype html>';
    this.xml = 0 == this.doctype.indexOf('<?xml');
  },

  /**
   * Buffer the given `str` exactly as is or with interpolation
   *
   * @param {String} str
   * @param {Boolean} interpolate
   * @api public
   */

  buffer: function(str, interpolate){
    var self = this;
    if (interpolate) {
      var match = /(\\)?([#!]){((?:.|\n)*)$/.exec(str);
      if (match) {
        this.buffer(str.substr(0, match.index), false);
        if (match[1]) { // escape
          this.buffer(match[2] + '{', false);
          this.buffer(match[3], true);
          return;
        } else {
          try {
            var rest = match[3];
            var range = parseJSExpression(rest);
            var code = ('!' == match[2] ? '' : 'jade.escape') + "((jade.interp = " + range.src + ") == null ? '' : jade.interp)";
          } catch (ex) {
            throw ex;
            //didn't match, just as if escaped
            this.buffer(match[2] + '{', false);
            this.buffer(match[3], true);
            return;
          }
          this.bufferExpression(code);
          this.buffer(rest.substr(range.end + 1), true);
          return;
        }
      }
    }

    str = JSON.stringify(str);
    str = str.substr(1, str.length - 2);

    if (this.lastBufferedIdx == this.buf.length) {
      if (this.lastBufferedType === 'code') this.lastBuffered += ' + "';
      this.lastBufferedType = 'text';
      this.lastBuffered += str;
      this.buf[this.lastBufferedIdx - 1] = 'buf.push(' + this.bufferStartChar + this.lastBuffered + '");'
    } else {
      this.buf.push('buf.push("' + str + '");');
      this.lastBufferedType = 'text';
      this.bufferStartChar = '"';
      this.lastBuffered = str;
      this.lastBufferedIdx = this.buf.length;
    }
  },

  /**
   * Buffer the given `src` so it is evaluated at run time
   *
   * @param {String} src
   * @api public
   */

  bufferExpression: function(src){
    var fn = Function('', 'return (' + src + ');');
    if (isConstant(src)) {
      return this.buffer(fn(), false)
    }
    if (this.lastBufferedIdx == this.buf.length) {
      if (this.lastBufferedType === 'text') this.lastBuffered += '"';
      this.lastBufferedType = 'code';
      this.lastBuffered += ' + (' + src + ')';
      this.buf[this.lastBufferedIdx - 1] = 'buf.push(' + this.bufferStartChar + this.lastBuffered + ');'
    } else {
      this.buf.push('buf.push(' + src + ');');
      this.lastBufferedType = 'code';
      this.bufferStartChar = '';
      this.lastBuffered = '(' + src + ')';
      this.lastBufferedIdx = this.buf.length;
    }
  },

  /**
   * Buffer an indent based on the current `indent`
   * property and an additional `offset`.
   *
   * @param {Number} offset
   * @param {Boolean} newline
   * @api public
   */

  prettyIndent: function(offset, newline){
    offset = offset || 0;
    newline = newline ? '\n' : '';
    this.buffer(newline + Array(this.indents + offset).join('  '));
    if (this.parentIndents)
      this.buf.push("buf.push.apply(buf, jade.indent);");
  },

  /**
   * Visit `node`, synchronous version.
   *
   * @param {Node} node
   * @param {Function|undefined} callback
   * @api public
   */

  visit: function(node, callback){
    this.runningSynchronously = !Boolean(callback);
    if (callback) {
      this.asynchronousVisit(node, callback);
      return;
    }

    var done = false, error = null;
    this.asynchronousVisit(node, function(err){
      done = true;
      error = err;
    });
    if (!done)
      throw new Error('Compiler has asynchronous dependencies, please use asynchronous mode with callback.');
    if (error)
      throw error;
  },

  /**
   * Visit `node`, asynchronous version.
   *
   * @param {Node} node
   * @param {Function} callback
   * @api private
   */

  asynchronousVisit: function(node, callback){
    var debug = this.debug;

    if (debug) {
      this.buf.push('jade_debug.unshift({ lineno: ' + node.line
        + ', filename: ' + (node.filename
        ? JSON.stringify(node.filename)
        : 'jade_debug[0].filename')
        + ' });');
    }

    // Massive hack to fix our context
    // stack for - else[ if] etc
    if (false === node.debug && this.debug) {
      this.buf.pop();
      this.buf.pop();
    }

    var that = this;
    this.visitNode(node, function(err){
      if (!err)
        if (debug) that.buf.push('jade_debug.shift();');
      callback(err);
    });
  },

  /**
   * Utility function to visit `node` with asynchrounous support.
   *
   * @param {Node} node
   * @param {Function} callback
   * @api private
   */

  internalVisit: function(node, syncPostProcess, callback){
    var that = this;
    try {
      this.asynchronousVisit(node, function(err){
        if (err)
          callback.call(that, err);
        else {
          try {
            syncPostProcess && syncPostProcess.call(that);
          } catch (ex) {
            callback.call(that, ex);
            return;
          }
          callback.call(that, null);
        }
      });
    } catch (ex) {
      callback.call(that, ex);
    }
  },

  /**
   * Visit `node`.
   *
   * @param {Node} node
   * @param {Function} callback
   * @api public
   */

  visitNode: function(node, callback){
    var name = node.constructor.name
      || node.constructor.toString().match(/function ([^(\s]+)()/)[1];
    if (name == 'Node')
      callback(null);
    else
      this['visit' + name](node, callback);
  },

  /**
   * Visit case `node`.
   *
   * @param {Literal} node
   * @param {Function} callback
   * @api public
   */

  visitCase: function(node, callback){
    var _ = this.withinCase;
    this.withinCase = true;
    this.buf.push('switch (' + node.expr + '){');
    this.internalVisit(node.block, function(){
      this.buf.push('}');
      this.withinCase = _;
    }, callback);
  },

  /**
   * Visit when `node`.
   *
   * @param {Literal} node
   * @param {Function} callback
   * @api public
   */

  visitWhen: function(node, callback){
    if ('default' == node.expr) {
      this.buf.push('default:');
    } else {
      this.buf.push('case ' + node.expr + ':');
    }
    this.internalVisit(node.block, function(){
      this.buf.push('  break;');
    }, callback);
  },

  /**
   * Visit literal `node`.
   *
   * @param {Literal} node
   * @param {Function} callback
   * @api public
   */

  visitLiteral: function(node, callback){
    this.buffer(node.str);
    callback(null);
  },

  /**
   * Visit all nodes in `block`.
   *
   * @param {Block} block
   * @param {Function} callback
   * @api public
   */

  visitBlock: function(block, callback){
    var len = block.nodes.length
      , escape = this.escape
      , pp = this.pp
      ;

    // Pretty print multi-line text
    if (pp && len > 1 && !escape && block.nodes[0].isText && block.nodes[1].isText)
      this.prettyIndent(1, true);

    var i = 0;
    runLoop.call(this, null);

    function runLoop(err){
      if (err) {
        callback(err);
        return;
      }
      if (i >= len) {
        callback(null);
        return;
      }

      // Pretty print text
      if (pp && i > 0 && !escape && block.nodes[i].isText && block.nodes[i - 1].isText)
        this.prettyIndent(1, false);

      this.internalVisit(block.nodes[i], function(){
        // Multiple text nodes are separated by newlines
        if (block.nodes[i + 1] && block.nodes[i].isText && block.nodes[i + 1].isText)
          this.buffer('\n');
        ++i;
      }, runLoop);
    }
  },

  /**
   * Visit a mixin's `block` keyword.
   *
   * @param {MixinBlock} block
   * @param {Function} callback
   * @api public
   */

  visitMixinBlock: function(block, callback){
    if (!this.inMixin) {
      throw new Error('Anonymous blocks are not allowed unless they are part of a mixin.');
    }
    if (this.pp) this.buf.push("jade.indent.push('" + Array(this.indents + 1).join('  ') + "');");
    this.buf.push('block && block();');
    if (this.pp) this.buf.push("jade.indent.pop();");
    callback(null);
  },

  /**
   * Visit `doctype`. Sets terse mode to `true` when html 5
   * is used, causing self-closing tags to end with ">" vs "/>",
   * and boolean attributes are not mirrored.
   *
   * @param {Doctype} doctype
   * @param {Function} callback
   * @api public
   */

  visitDoctype: function(doctype, callback){
    this.processDoctype(doctype);
    callback(null);
  },

  /**
   * Process `doctype`, see visitDoctype.
   *
   * @param {Doctype} doctype
   * @api private
   */

  processDoctype: function(doctype){
    if (doctype && (doctype.val || !this.doctype)) {
      this.setDoctype(doctype.val || 'default');
    }

    if (this.doctype) this.buffer(this.doctype);
    this.hasCompiledDoctype = true;
  },

  /**
   * Visit `mixin`, generating a function that
   * may be called within the template.
   *
   * @param {Mixin} mixin
   * @param {Function} callback
   * @api public
   */

  visitMixin: function(mixin, callback){
    var name = mixin.name.replace(/-/g, '_') + '_mixin'
      , args = mixin.args || ''
      , block = mixin.block
      , attrs = mixin.attrs
      , pp = this.pp;

    if (mixin.call) {
      if (pp) this.buf.push("jade.indent.push('" + Array(this.indents + 1).join('  ') + "');");
      if (block || attrs.length) {

        this.buf.push(name + '.call({');

        if (block) {
          this.buf.push('block: function(){');

          // Render block with no indents, dynamically added when rendered
          this.parentIndents++;
          var _indents = this.indents;
          this.indents = 0;
          this.internalVisit(mixin.block, function(){
            this.indents = _indents;
            this.parentIndents--;

            if (attrs.length) {
              this.buf.push('},');
            } else {
              this.buf.push('}');
            }

            finish.call(this);

            if (pp) this.buf.push("jade.indent.pop();");
          }, callback);
          return;
        }

        finish.call(this);

        function finish(){
          if (attrs.length) {
            var val = this.attrs(attrs);
            if (val.inherits) {
              this.buf.push('attributes: jade.merge({' + val.buf
                + '}, attributes), escaped: jade.merge(' + val.escaped + ', escaped, true)');
            } else {
              this.buf.push('attributes: {' + val.buf + '}, escaped: ' + val.escaped);
            }
          }

          if (args) {
            this.buf.push('}, ' + args + ');');
          } else {
            this.buf.push('});');
          }
        }

      } else {
        this.buf.push(name + '(' + args + ');');
      }
      if (pp) this.buf.push("jade.indent.pop();");
      callback(null);
    } else {
      this.buf.push('var ' + name + ' = function(' + args + '){');
      this.buf.push('var block = this.block, attributes = this.attributes || {}, escaped = this.escaped || {};');
      this.parentIndents++;
      this.inMixin = true;
      this.internalVisit(block, function(){
        this.inMixin = false;
        this.parentIndents--;
        this.buf.push('};');
      }, callback);
    }
  },

  /**
   * Visit `tag` buffering tag markup, generating
   * attributes, visiting the `tag`'s code and block.
   *
   * @param {Tag} tag
   * @param {Function} callback
   * @api public
   */

  visitTag: function(tag, callback){
    this.indents++;
    var name = tag.name
      , pp = this.pp
      , self = this;

    function bufferName(){
      if (tag.buffer) self.bufferExpression(name);
      else self.buffer(name);
    }

    if (!this.hasCompiledTag) {
      if (!this.hasCompiledDoctype && 'html' == name) {
        this.processDoctype();
      }
      this.hasCompiledTag = true;
    }

    // pretty print
    if (pp && !tag.isInline())
      this.prettyIndent(0, true);

    if ((~selfClosing.indexOf(name) || tag.selfClosing) && !this.xml) {
      this.buffer('<');
      bufferName();
      this.processAttributes(tag.attrs);
      this.terse
        ? this.buffer('>')
        : this.buffer('/>');
      this.indents--;
      callback(null);
    } else {
      // Optimize attributes buffering
      if (tag.attrs.length) {
        this.buffer('<');
        bufferName();
        if (tag.attrs.length) this.processAttributes(tag.attrs);
        this.buffer('>');
      } else {
        this.buffer('<');
        bufferName();
        this.buffer('>');
      }
      if (tag.code) this.internalVisit(tag.code, null, finish);
      else finish.call(this, null);

      function finish(err){
        if (err) {
          callback(err);
          return;
        }

        this.escape = 'pre' == tag.name;
        this.internalVisit(tag.block, function(){
          // pretty print
          if (pp && !tag.isInline() && 'pre' != tag.name && !tag.canInline())
            this.prettyIndent(0, true);

          this.buffer('</');
          bufferName();
          this.buffer('>');
          this.indents--;
        }, callback);
      }
    }
  },

  /**
   * Visit `filter`, throwing when the filter does not exist.
   *
   * @param {Filter} filter
   * @param {Function} callback
   * @api public
   */

  visitFilter: function(filter, callback){
    var text = filter.block.nodes.map(
      function(node){ return node.val; }
    ).join('\n');
    filter.attrs = filter.attrs || {};
    filter.attrs.filename = this.options.filename;
    if (this.runningSynchronously || true) {
      var filterResult;
      try {
        filterResult = filters(filter.name, text, filter.attrs);
      } catch (ex) {
        callback(ex);
        return;
      }
      this.buffer(filterResult, true);
      callback(null);
    }
  },

  /**
   * Visit `text` node.
   *
   * @param {Text} text
   * @param {Function} callback
   * @api public
   */

  visitText: function(text, callback){
    this.buffer(text.val, true);
    callback(null);
  },

  /**
   * Visit a `comment`, only buffering when the buffer flag is set.
   *
   * @param {Comment} comment
   * @param {Function} callback
   * @api public
   */

  visitComment: function(comment, callback){
    if (comment.buffer) {
      if (this.pp) this.prettyIndent(1, true);
      this.buffer('<!--' + comment.val + '-->');
    }
    callback(null);
  },

  /**
   * Visit a `BlockComment`.
   *
   * @param {Comment} comment
   * @param {Function} callback
   * @api public
   */

  visitBlockComment: function(comment, callback){
    if (!comment.buffer) return;
    if (this.pp) this.prettyIndent(1, true);
    this.buffer('<!--' + comment.val);
    this.internalVisit(comment.block, function(){
      if (this.pp) this.prettyIndent(1, true);
      this.buffer('-->');
    }, callback);
  },

  /**
   * Visit `code`, respecting buffer / escape flags.
   * If the code is followed by a block, wrap it in
   * a self-calling function.
   *
   * @param {Code} code
   * @param {Function} callback
   * @api public
   */

  visitCode: function(code, callback){
    // Wrap code blocks with {}.
    // we only wrap unbuffered code blocks ATM
    // since they are usually flow control

    // Buffer code
    if (code.buffer) {
      var val = code.val.trimLeft();
      val = 'null == (jade.interp = ' + val + ') ? "" : jade.interp';
      if (code.escape) val = 'jade.escape(' + val + ')';
      this.bufferExpression(val);
    } else {
      this.buf.push(code.val);
    }

    // Block support
    if (code.block) {
      if (!code.buffer) this.buf.push('{');
      this.internalVisit(code.block, function(){
        if (!code.buffer) this.buf.push('}');
      }, callback);
    } else
      callback(null);
  },

  /**
   * Visit `each` block.
   *
   * @param {Each} each
   * @param {Function} callback
   * @api public
   */

  visitEach: function(each, callback){
    this.buf.push(''
      + '// iterate ' + each.obj + '\n'
      + ';(function(){\n'
      + '  var $$obj = ' + each.obj + ';\n'
      + '  if (\'number\' == typeof $$obj.length) {\n');

    if (each.alternative) {
      this.buf.push('  if ($$obj.length) {');
    }

    this.buf.push(''
      + '    for (var ' + each.key + ' = 0, $$l = $$obj.length; ' + each.key + ' < $$l; ' + each.key + '++) {\n'
      + '      var ' + each.val + ' = $$obj[' + each.key + '];\n');

    this.internalVisit(each.block, null, step2);

    function step2(err){
      if (err) {
        callback(err);
        return;
      }

      this.buf.push('    }\n');

      if (each.alternative) {
        this.buf.push('  } else {');
        this.internalVisit(each.alternative, function(){
          this.buf.push('  }');
        }, step3);
      } else
        step3.call(this, null);
    }

    function step3(err){
      if (err) {
        callback(err);
        return;
      }

      this.buf.push(''
        + '  } else {\n'
        + '    var $$l = 0;\n'
        + '    for (var ' + each.key + ' in $$obj) {\n'
        + '      $$l++;'
        + '      var ' + each.val + ' = $$obj[' + each.key + '];\n');

      this.internalVisit(each.block, null, step4);
    }

    function step4(err){
      if (err) {
        callback(err);
        return;
      }

      this.buf.push('    }\n');
      if (each.alternative) {
        this.buf.push('    if ($$l === 0) {');
        this.internalVisit(each.alternative, function(){
          this.buf.push('    }');
        }, step5);
      } else
        step5.call(this, null);
    }

    function step5(err){
      if (err) {
        callback(err);
        return;
      }

      this.buf.push('  }\n}).call(this);\n');
      callback(null);
    }
  },

  /**
   * Visit `attrs`.
   *
   * @param {Array} attrs
   * @param {Function} callback
   * @api public
   */

  visitAttributes: function(attrs, callback){
    this.processAttributes(attrs);
    callback(null);
  },

  /**
   * Process `attrs`.
   *
   * @param {Array} attrs
   * @api private
   */

  processAttributes: function(attrs){
    var val = this.attrs(attrs);
    if (val.inherits) {
      this.bufferExpression("jade.attrs(jade.merge({ " + val.buf +
        " }, attributes), jade.merge(" + val.escaped + ", escaped, true))");
    } else if (val.constant) {
      this.buffer(runtime.attrs(toConstant('{' + val.buf + '}'), JSON.parse(val.escaped)));
    } else {
      this.bufferExpression("jade.attrs({ " + val.buf + " }, " + val.escaped + ")");
    }
  },

  /**
   * Compile attributes.
   */

  attrs: function(attrs){
    var buf = []
      , classes = []
      , escaped = {}
      , constant = attrs.every(function(attr){ return isConstant(attr.val) })
      , inherits = false;

    if (this.terse) buf.push('terse: true');

    attrs.forEach(function(attr){
      if (attr.name == 'attributes') return inherits = true;
      escaped[attr.name] = attr.escaped;
      if (attr.name == 'class') {
        classes.push('(' + attr.val + ')');
      } else {
        var pair = "'" + attr.name + "':(" + attr.val + ')';
        buf.push(pair);
      }
    });

    if (classes.length) {
      buf.push('"class": [' + classes.join(',') + ']');
    }

    return {
      buf: buf.join(', '),
      escaped: JSON.stringify(escaped),
      inherits: inherits,
      constant: constant
    };
  }
};
