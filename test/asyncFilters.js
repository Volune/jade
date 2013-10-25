/**
 * Module dependencies.
 */

var jade = require('../')
  , assert = require('assert')
  , transformers = require('transformers')
  , Transformer = require('transformers/lib/shared')
  ;

transformers.asyncFilter = new Transformer({
  name: 'asyncFilter',
  engines: ['.'],
  outputFormat: 'text',
  sudoSync: false,
  async: function(str, options, callback){
    setTimeout(function(){
      callback(null, str);
    }, 10);
  }
});

describe('Asynchronous filter', function(){

  var str = [
    ':asyncFilter',
    '  Test',
  ].join('\r\n');

  var html = [
    'Test'
  ].join('');

  it('should use asynchronous filter', function(done){
    jade.async.render(str, function(err, result){
      if (err)
        done(err);
      else {
        assert.equal(html, result);
        done();
      }
    });
  });

  it('should fail synchronous compilation with asynchronous filter', function(){
    try {
      jade.render(str);
    } catch (ex) {
      ex.should.be.an.instanceof(Error);
      console.log(ex);
      return;
    }
    throw new Error(test + ' should have thrown an error');
  });

});
