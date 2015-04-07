// Gulp Dependencies
var gulp = require('gulp');
var rename = require('gulp-rename');

// Build Dependencies
var browserify = require('browserify');
var transform = require('vinyl-transform')
var uglify = require('gulp-uglify');

// Style Dependencies
var sourcemaps = require('gulp-sourcemaps');
var stylus = require('gulp-stylus');
var prefix = require('gulp-autoprefixer');
var minifyCSS = require('gulp-minify-css');

// Development Dependencies
var jshint = require('gulp-jshint');

// Test Dependencies
var mochaPhantomjs = require('gulp-mocha-phantomjs');

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

gulp.task('browserify-client', ['lint-client'], function() {
	var browserified = transform(function(filename) {
		var b = browserify({entries: filename, debug: true});
		return b.bundle();
	});

	return gulp.src('client/index.js')
		.pipe(browserified)
		.pipe(rename('todoist-backbone.js'))
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

gulp.task('watch', function() {
	gulp.watch('client/**/*.styl', ['styles']);
	gulp.watch('client/**/*.js', ['browserify-client', 'test']);
	gulp.watch('test/client/**/*.js', ['test']);
});

gulp.task('test', ['lint-test', 'browserify-test'], function() {
	return gulp.src('test/client/index.html')
		.pipe(mochaPhantomjs());
});

gulp.task('styles', function() {
	return gulp.src('client/stylus/index.styl')
		.pipe(sourcemaps.init())
		.pipe(stylus())
		.pipe(prefix({ cascade: true }))
		.pipe(sourcemaps.write())
		.pipe(rename('todoist-backbone.css'))
		.pipe(gulp.dest('build'))
		.pipe(gulp.dest('public/stylesheets'));
});

gulp.task('minify', ['styles'], function() {
	return gulp.src('build/todoist-backbone.css')
		.pipe(minifyCSS())
		.pipe(rename('todoist-backbone.min.css'))
		.pipe(gulp.dest('public/stylesheets'));
});

gulp.task('uglify', ['browserify-client'], function() {
  return gulp.src('build/todoist-backbone.js')
    .pipe(uglify())
    .pipe(rename('todoist-backbone.min.js'))
    .pipe(gulp.dest('public/javascripts'));
});

gulp.task('build', ['uglify', 'minify']);

gulp.task('default', ['test', 'build', 'watch']);