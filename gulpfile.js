// Gulp Dependencies
var gulp = require('gulp');
var rename = require('gulp-rename');

// Build Dependencies
var transform = require('vinyl-transform');
var browserify = require('browserify');
var uglify = require('gulp-uglify');

// Style Dependencies
var less = require('gulp-less');
var prefix = require('gulp-autoprefixer');
var minifyCSS = require('gulp-minify-css');

// Development Dependencies
var jshint = require('gulp-jshint');

// Test Dependencies
var mochaPhantomjs = require('gulp-mocha-phantomjs');



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
		var b = browserify({entries: filename, debug: true});
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
		var b = browserify({entries: filename, debug: true});
		return b.bundle();
	});

  return gulp.src('test/client/index.js')
    .pipe(browserified)
    .pipe(rename('client-test.js'))
    .pipe(gulp.dest('build'));
});



// Styles

gulp.task('styles', function() {
  return gulp.src('client/less/index.less')
    .pipe(less())
    .pipe(prefix({ cascade: true }))
    .pipe(rename('main.css'))
    .pipe(gulp.dest('build'))
    .pipe(gulp.dest('public/stylesheets'));
});



// Build

gulp.task('minify', ['styles'], function() {
  return gulp.src('build/main.css')
    .pipe(minifyCSS())
    .pipe(rename('main.min.css'))
    .pipe(gulp.dest('public/stylesheets'));
});

gulp.task('uglify', ['browserify-client'], function() {
  return gulp.src('build/main.js')
    .pipe(uglify())
    .pipe(rename('main.min.js'))
    .pipe(gulp.dest('public/javascripts'));
});



// Test

gulp.task('test', ['lint-test', 'browserify-test'], function() {
  return gulp.src('test/client/index.html')
    .pipe(mochaPhantomjs());
});

gulp.task('watch', function() {
  gulp.watch('client/**/*.js', ['browserify-client', 'test']);
  gulp.watch('test/client/**/*.js', ['test']);
  gulp.watch('client/**/*.less', ['styles']);
});



// Tasks

gulp.task('build', ['uglify', 'minify']);
gulp.task('default', ['test', 'build', 'watch']);
