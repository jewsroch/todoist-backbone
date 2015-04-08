// Gulp Dependencies
var gulp = require('gulp'),
  rename = require('gulp-rename');

// Bower
var bower = require('gulp-bower');

// Build Dependencies
var transform = require('vinyl-transform'),
  browserify = require('browserify'),
  uglify = require('gulp-uglify');

// Style Dependencies
var sass = require('gulp-ruby-sass'),
  notify = require('gulp-notify'),
  prefix = require('gulp-autoprefixer'),
  minifyCSS = require('gulp-minify-css');

// Development Dependencies
var jshint = require('gulp-jshint');
var browserSync = require('browser-sync');
var reload = browserSync.reload

// Test Dependencies
var mochaPhantomjs = require('gulp-mocha-phantomjs');

var config = {
  sassPath: './client/sass',
  bowerDir: './bower_components'
};

// Bower
gulp.task('bower', function() {
  return bower()
    .pipe(gulp.dest(config.bowerDir));
});

// Lint
gulp.task('lint-client', function() {
  return gulp.src('./client/**/*.js')
    .pipe(jshint())
    .pipe(jshint.reporter('default'));
});

gulp.task('lint-test', function() {
  return gulp.src('./test/**/*.js')
    .pipe(jshint())
    .pipe(jshint.reporter('default'));
});



// Browserify
gulp.task('browserify-client', ['lint-client'], function() {
  var browserified = transform(function(filename) {
    var b = browserify({
      entries: filename,
      debug: true
    });
    return b.bundle();
  });

  return gulp.src('client/index.js')
    .pipe(browserified)
    .pipe(rename('main.js'))
    .pipe(gulp.dest('build'))
    .pipe(gulp.dest('public/javascripts'));
});


gulp.task('browserify-test', ['lint-test'], function() {
  var browserified = transform(function(filename) {
    var b = browserify({
      entries: filename,
      debug: true
    });
    return b.bundle();
  });

  return gulp.src('test/client/index.js')
    .pipe(browserified)
    .pipe(rename('client-test.js'))
    .pipe(gulp.dest('build'));
});


// Icons
gulp.task('icons', function() {
  return gulp.src(config.bowerDir + '/fontawesome/fonts/**.*')
    .pipe(gulp.dest('./public/fonts'));
});



// Styles

gulp.task('styles', function() {
  return gulp.src('./client/sass/index.scss')
    .pipe(sass({
      style: 'expanded',
      loadPath: [
        './client/sass',
        config.bowerDir + '/bootstrap-sass-official/assets/stylesheets',
        config.bowerDir + '/fontawesome/scss'
      ]
    }).on('error', notify.onError(function(error) {
      return "Error:" + error.message;
    })))
    .pipe(gulp.dest('build'))
    .pipe(gulp.dest('public/stylesheets'))
    .pipe(browserSync.reload({
      stream: true
    }));
});


// Build

gulp.task('minify', ['styles'], function() {
  return gulp.src('build/index.css')
    .pipe(minifyCSS())
    .pipe(rename('index.min.css'))
    .pipe(gulp.dest('public/stylesheets'));
});

gulp.task('uglify', ['browserify-client'], function() {
  return gulp.src('build/main.js')
    .pipe(uglify())
    .pipe(rename('main.min.js'))
    .pipe(gulp.dest('public/javascripts'))
    .pipe(browserSync.reload({
      stream: true
    }));
});



// Test

gulp.task('test', ['lint-test', 'browserify-test'], function() {
  return gulp.src('test/client/index.html')
    .pipe(mochaPhantomjs());
});

gulp.task('watch', ['browserSync'], function() {
  gulp.watch('client/**/*.js', ['browserify-client', 'test']);
  gulp.watch('test/client/**/*.js', ['test']);
  gulp.watch('client/**/*.scss', ['styles']);
  gulp.watch('public/*.html').on('change', reload);
});



// Tasks

gulp.task('build', ['uglify', 'minify']);
gulp.task('default', ['icons', 'test', 'build', 'watch']);
