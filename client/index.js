var $ = require('jquery');
var Backbone = require('backbone');
var _ = require('underscore');
Backbone.$ = $;

var Project = Backbone.Model.extend();

var Projects = Backbone.Collection.extend({
	model: Project,
	url: function() {
		return 'https://todoist.com/API/v6/sync?token=c023233627fb3bf2b0bca22c632eda0ef8005914&seq_no=0&resource_types=["projects"]';
	},
	parse: function(res, xhr) {
		console.log(res);
		return res.Projects;
	}
});

var ProjectsView = Backbone.View.extend({
	initialize: function() {
		_.bindAll(this, 'render');

		this.collection = new Projects();

		var that = this;
		this.collection.fetch({
			success: function() {
				that.render();
			}
		});
	},

	template: _.template($('#projectsTemplate').html()),

	render: function() {
		$(this.el).html(this.template({
			projects: this.collection.toJSON()
		}));
	}
});

var app = new ProjectsView({
	el: $('#projects')
});
