let ShrunkedBrowser = {
	init: function() {
		let appcontent = document.getElementById('appcontent');
		if (appcontent) {
			appcontent.addEventListener('change', this.onActivate.bind(this), true);
		}

		setTimeout(function() {
			Shrunked.showStartupNotification(gBrowser.getNotificationBox(), function(aURL) {
				gBrowser.selectedTab = gBrowser.addTab(aURL);
			});
		}, 1000);
	},

	onActivate: function(aEvent) {
		if (aEvent.target.localName != 'input' || aEvent.target.type != 'file') {
			return;
		}

		Task.spawn((function onActivateInternal() {
			let inputTag = aEvent.target;
			let form = inputTag.form;
			let context = PrivateBrowsingUtils.privacyContextFromWindow(window);
			let uri = inputTag.ownerDocument.documentURIObject;

			if (uri.schemeIs('http') || uri.schemeIs('https')) {
				if (yield Shrunked.getContentPref(uri, 'extensions.shrunked.disabled', context)) {
					return;
				}
				let maxWidth = yield Shrunked.getContentPref(uri, 'extensions.shrunked.maxWidth', context);
				let maxHeight = yield Shrunked.getContentPref(uri, 'extensions.shrunked.maxHeight', context);
				if (maxWidth && maxHeight) {
					this.resize(inputTag, maxWidth, maxHeight,
						Shrunked.prefs.getIntPref('default.quality'));
					return;
				}
			}

			if (form) {
				let maxWidth = form.getAttribute('shrunkedmaxwidth');
				let maxHeight = form.getAttribute('shrunkedmaxheight');
				if (maxWidth && maxHeight) {
					this.resize(inputTag, parseInt(maxWidth), parseInt(maxHeight),
						Shrunked.prefs.getIntPref('default.quality'));
					return;
				}
			}

			if (form) {
				this.imageURLs = [];
				for (let input of form.querySelectorAll('input[type="file"]')) {
					this.imageURLs = this.imageURLs.concat(this.getURLsFromInputTag(input));
				}
			} else {
				this.imageURLs = this.getURLsFromInputTag(inputTag);
			}

			if (!this.imageURLs.length) {
				return;
			}

			let notifyBox = gBrowser.getNotificationBox();
			if (notifyBox.getNotificationWithValue('shrunked-notification')) {
				return;
			}

			let buttons = [];

			buttons.push({
				accessKey: Shrunked.strings.GetStringFromName('yes_accesskey'),
				callback: this.showOptionsDialog,
				label: Shrunked.strings.GetStringFromName('yes_label'),
				inputTag: inputTag,
				form: form,
				context: context,
				uri: uri
			});

			if (!PrivateBrowsingUtils.isWindowPrivate(window) &&
					(uri.schemeIs('http') || uri.schemeIs('https'))) {
				buttons.push({
					accessKey: Shrunked.strings.GetStringFromName('never_accesskey'),
					callback: this.disableForSite,
					label: Shrunked.strings.GetStringFromName('never_label'),
					context: context,
					uri: uri
				});
			}
			buttons.push({
				accessKey: Shrunked.strings.GetStringFromName('no_accesskey'),
				callback: function() {},
				label: Shrunked.strings.GetStringFromName('no_label'),
			});

			let questions = Shrunked.strings.GetStringFromName('questions');
			let question = Shrunked.getPluralForm(this.imageURLs.length, questions);

			notifyBox = gBrowser.getNotificationBox();
			notifyBox.removeAllNotifications(true);
			let notification = notifyBox.appendNotification(
				question, 'shrunked-notification', null, notifyBox.PRIORITY_INFO_HIGH, buttons
			);

			inputTag.ownerDocument.addEventListener('unload', function() {
				notifyBox.removeNotification(notification);
			});
		}).bind(this));
	},

	showOptionsDialog: function(aNotification, aButtonObject) {
		let {inputTag, form, context, uri} = aButtonObject;
		let returnValues = { cancelDialog: true, inputTag: inputTag };

		window.openDialog('chrome://shrunked/content/options.xul', 'options',
			'chrome,centerscreen,modal', returnValues, ShrunkedBrowser.imageURLs);

		if (returnValues.cancelDialog) {
			return;
		}

		if (form) {
			form.setAttribute('shrunkedmaxwidth', returnValues.maxWidth);
			form.setAttribute('shrunkedmaxheight', returnValues.maxHeight);

			for (let input of form.querySelectorAll('input[type="file"]')) {
				ShrunkedBrowser.resize(input, returnValues.maxWidth, returnValues.maxHeight, Shrunked.prefs.getIntPref('default.quality'));
			}
		} else {
			ShrunkedBrowser.resize(inputTag, returnValues.maxWidth, returnValues.maxHeight, Shrunked.prefs.getIntPref('default.quality'));
		}

		if (returnValues.rememberSite && (uri.schemeIs('http') || uri.schemeIs('https'))) {
			Shrunked.contentPrefs2.set(uri.host, 'extensions.shrunked.maxWidth', returnValues.maxWidth, context);
			Shrunked.contentPrefs2.set(uri.host, 'extensions.shrunked.maxHeight', returnValues.maxHeight, context);
		}
	},

	disableForSite: function(aNotification, aButtonObject) {
		let {context, uri} = aButtonObject;
		Shrunked.contentPrefs2.set(uri.host, 'extensions.shrunked.disabled', true, context);
	},

	getURLsFromInputTag: function(aInputTag) {
		let paths = aInputTag.mozGetFileNameArray();
		let URLs = [];

		for (let path of paths) {
			if (/\.jpe?g$/i.test(path) && Shrunked.fileLargerThanThreshold(path)) {
				let sourceFile = new FileUtils.File(path);
				let sourceURL = Services.io.newFileURI(sourceFile);
				URLs.push(sourceURL.spec);
			}
		}
		return URLs;
	},

	resize: function(aInputTag, aMaxWidth, aMaxHeight, aQuality) {
		let paths = aInputTag.mozGetFileNameArray();
		let newPaths = [];

		aInputTag.originalValue = paths;
		aInputTag.addEventListener('click', ShrunkedBrowser.resetInputTag, true);

		for (let path of paths) {
			if (/\.jpe?g$/i.test(path) && Shrunked.fileLargerThanThreshold(path)) {
				Shrunked.resize(new FileUtils.File(path), aMaxWidth, aMaxHeight, aQuality).then(function(destFile) {
					newPaths.push(destFile);
					if (newPaths.length == paths.length) {
						aInputTag.mozSetFileNameArray(newPaths, newPaths.length);
					}
				}, Components.utils.reportError);
			} else {
				newPaths.push(path);
			}
		}
	},

	resetInputTag: function(aEvent) {
		let inputTag = aEvent.target;
		let paths = inputTag.originalValue;
		inputTag.mozSetFileNameArray(paths, paths.length);
		inputTag.originalValue = null;
	}
};

Components.utils.import('resource://gre/modules/XPCOMUtils.jsm');
XPCOMUtils.defineLazyModuleGetter(window, 'FileUtils', 'resource://gre/modules/FileUtils.jsm');
XPCOMUtils.defineLazyModuleGetter(window, 'Services', 'resource://gre/modules/Services.jsm');
XPCOMUtils.defineLazyModuleGetter(window, 'Shrunked', 'resource://shrunked/shrunked.jsm');
XPCOMUtils.defineLazyModuleGetter(window, 'Task', 'resource://gre/modules/Task.jsm');

window.addEventListener('load', ShrunkedBrowser.init.bind(ShrunkedBrowser));
