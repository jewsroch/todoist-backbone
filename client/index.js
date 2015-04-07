
var $ = require('jquery');
var _ = require('underscore');
var Backbone = require('backbone');
Backbone.$ = $;

var ListView = Backbone.View.extend({
  el: $('body'),

  initialize: function() {
    _.bindAll(this, 'render');

    this.render();
  },

  render: function() {
    $(this.el).append('<h1>hello world</h1>');
  }
});

var listView = new ListView();
