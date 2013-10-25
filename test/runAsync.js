/**
 * Module dependencies.
 */

var jade = require('../')
  , fs = require('fs')
  , uglify = require('uglify-js');

// test cases

var cases = fs.readdirSync('test/cases').filter(function(file){
  return ~file.indexOf('.jade');
}).map(function(file){
    return file.replace('.jade', '');
  });
try {
  fs.mkdirSync(__dirname + '/output');
} catch (ex) {
  if (ex.code !== 'EEXIST') {
    throw ex;
  }
}
try {
  fs.mkdirSync(__dirname + '/output/async');
} catch (ex) {
  if (ex.code !== 'EEXIST') {
    throw ex;
  }
}

describe('test cases (asynchronous compilation)', function(){
  cases.forEach(function(test){
    var name = test.replace(/[-.]/g, ' ');
    it(name, function(done){
      var path = 'test/cases/' + test + '.jade';
      var str = fs.readFileSync(path, 'utf8');
      var html = fs.readFileSync('test/cases/' + test + '.html', 'utf8').trim().replace(/\r/g, '');
      jade.async.compile(str, { filename: path, pretty: true, basedir: 'test/cases' }, function(err, fn){
        if (err) {
          done(err);
          return;
        }
        var actual = fn({ title: 'Jade' });

        fs.writeFileSync(__dirname + '/output/async/' + test + '.html', actual);
        if (/filter/.test(test)) {
          actual = actual.replace(/\n| /g, '');
          html = html.replace(/\n| /g, '')
        }
        JSON.stringify(actual.trim()).should.equal(JSON.stringify(html));

        done();
      });
    })
  });
});


// test cases

var anti = fs.readdirSync('test/anti-cases').filter(function(file){
  return ~file.indexOf('.jade');
}).map(function(file){
    return file.replace('.jade', '');
  });

describe('certain syntax is not allowed and will throw a compile time error (asynchronous compilation)', function(){
  anti.forEach(function(test){
    var name = test.replace(/[-.]/g, ' ');
    it(name, function(done){
      var path = 'test/anti-cases/' + test + '.jade';
      var str = fs.readFileSync(path, 'utf8');
      jade.async.compile(str, { filename: path, pretty: true, basedir: 'test/anti-cases' }, function(err){
        err.should.be.an.instanceof(Error);
        done();
      });
      //should not throw an exception
    })
  });
});