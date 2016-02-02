module.exports = MyCokeRewards;

var request = require('request');
var fs = require('fs');

function MyCokeRewards(username, password) {
	var jar = request.jar();
	this._request = request.defaults({jar: jar});
	this._username = username;
	this._password = password;
	this._rateLimitExpire = 0;
	
	this.debug = false;
}

MyCokeRewards.prototype._debug = function(message) {
	if(this.logDebug) {
		this.logDebug.call(this, typeof message === 'string' ? message : message.toString());
	}
};

MyCokeRewards.prototype._dumpResponse = function(response) {
	if(!this.debug) {
		return "<<DEBUG MODE DISABLED>>";
	}
	
	var self = this;
	var filename = Date.now();
	
	var contents = response.req.method + " " + response.req.path + "\nHost: " + response.req._headers.host + "\n\n" + response.body;
	
	self._debug("Writing HTTP response");
	
	fs.writeFile(__dirname + "/http_responses/" + filename + ".txt", contents, function(err) {
		if(err && err.code == 'ENOENT') {
			fs.mkdir(__dirname + "/http_responses", function(err) {
				if(err) {
					self._debug("Can't make http_responses directory! " + err);
				} else {
					fs.writeFile(__dirname + "/http_responses/" + filename + ".txt", contents);
				}
			});
		} else if(err) {
			self._debug("Can't write HTTP response! " + err);
		}
	});
	
	return filename;
};

// https://www.mycokerewards.com/etc/designs/mcr/default/global/js/enterCode.js
MyCokeRewards.prototype.redeemCode = function(code, callback, retry) {
	var self = this;
	self._debug("Preflighting code " + code);
	self._request.post("http://www.mycokerewards.com/ajax/v1/code/" + encodeURIComponent(code), function(error, response, body) {
		if(error || response.statusCode != 200) {
			callback("Error preflighting code: " + (error || "HTTP status " + response.statusCode) + ", dump to " + self._dumpResponse(response));
			return;
		}
		
		var json;
		try {
			json = JSON.parse(body);
		} catch(e) {
			callback("Got bad JSON preflighting code " + code + ", dump to " + self._dumpResponse(response));
			return;
		}
		
		if(!json.pointsAwarded && !json.errorMessageInfo.errorMessage) {
			if(retry) {
				callback("No points awarded, no message, can't login. Dump to " + self._dumpResponse(response));
			} else {
				self._debug("Logging in to redeem code");
				self._redeemCodeLogin(code, callback);
			}
			
			return;
		}
		
		if((json.responseCode != 0 && json.responseCode != 1) || !json.pointsAwarded) {
			callback(null, json.errorMessageInfo.errorMessage);
			return;
		}
		
		if(json.responseCode == 0) {
			// This happens when there's no brand selector
			callback(null, json.errorMessageInfo.errorMessage, json.pointsAwarded, json.pointsBalance);
			return;
		}
		
		self._debug("Getting brand selector for code");
		
		// Get brands
		self._request("http://www.mycokerewards.com/ajax/v1/brand", function(err, response, body) {
			if(err || response.statusCode != 200) {
				callback("Error getting brands: " + (err || "HTTP status " + response.statusCode) + ". Dump to " + self._dumpResponse(response));
				return;
			}
			
			var brand = body.match(/brand-id="([^"]+)"/);
			if(!brand) {
				callback("Couldn't find any brand-id! Dump to " + self._dumpResponse(response));
				return;
			}
			
			self._debug("Using brand ID " + brand[1]);
			
			self._request.post("http://www.mycokerewards.com/ajax/v1/brand/" + brand[1] + "?code=" + encodeURIComponent(code), function(err, response, body) {
				if(err || response.statusCode != 200) {
					callback("Couldn't commit code " + code + " to brand " + brand[1] + ": " + (err || "HTTP status " + response.statusCode) + ". Dump to " + self._dumpResponse(response));
					return;
				}
				
				var json;
				try {
					json = JSON.parse(body);
				} catch(e) {
					callback("Invalid JSON committing code " + code + " to brand " + brand[1] + ". Dump to " + self._dumpResponse(response));
					return;
				}
				
				callback(null, json.errorMessageInfo.errorMessage, json.pointsAwarded, json.pointsBalance);
			});
		});
	});
};

MyCokeRewards.prototype._redeemCodeLogin = function(code, callback) {
	var self = this;
	this._login(function(error) {
		if(error) {
			callback(error);
		} else {
			self.redeemCode(code, callback, true);
		}
	});
};

MyCokeRewards.prototype.getEarnedPoints = function(callback, retry) {
	var self = this;
	self._request.get("http://www.mycokerewards.com/ajax/v1/header/pointsHistory", function(error, response, body) {
		if(error) {
			callback(error + ". Dump to " + self._dumpResponse(response));
			return;
		}
		
		if(response.statusCode != 200) {
			if(retry) {
				callback("Invalid status code: " + response.statusCode + ". Dump to " + self._dumpResponse(response));
			} else {
				self._getEarnedPointsLogin(callback);
			}
			
			return;
		}
		
		var pointData;
		try {
			pointData = JSON.parse(body);
		} catch(e) {
			callback("Invalid JSON received. Dump to " + self._dumpResponse(response));
			return;
		}
		
		if(pointData.globalErrors && pointData.globalErrors.length) {
			if(retry) {
				callback("Can't get points. Dump to " + self._dumpResponse(response));
			} else {
				self._getEarnedPointsLogin(callback);
			}
			
			return;
		}
		
		if(!pointData.pointsHistoryHeader || !pointData.pointsHistoryHeader.pointLimit) {
			self._debug(pointData);
			callback("Got unexpected data. Dump to " + self._dumpResponse(response));
			return;
		}
		
		callback(null, pointData.pointsHistoryHeader.pointsRedeemed, pointData.pointsHistoryHeader.pointLimit);
	});
};

MyCokeRewards.prototype._getEarnedPointsLogin = function(callback) {
	var self = this;
	this._login(function(error) {
		if(error) {
			callback(error);
		} else {
			self.getEarnedPoints(callback, true);
		}
	});
};

MyCokeRewards.prototype._login = function(callback) {
	if(this._rateLimitExpire > Date.now()) {
		callback("Can't login: on rate-limit cooldown for another " + ((this._rateLimitExpire - Date.now()) / 1000) + " seconds.");
		return;
	}
	
	var self = this;
	var chars = 'abcdefghijklmnopqrstuvwxyz1234567890';
	var txid = '';
	
	for(var i = 0; i < 40; i++) {
		txid += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	
	self._debug("Using transaction " + txid);
	
	self._request.get("http://www.mycokerewards.com/account/authenticate", function(err, response, body) {
		self._debug("Hit authenticate page, proceeding with authentication...");
		
		self._request.post("https://coca-cola.janraincapture.com/widget/traditional_signin.jsonp", {"form":
			{
				"capture_screen": "signIn",
				"capture_transactionId": txid,
				"client_id": "x3qnqceq3fqppxuhmt59jjhs8krv96jc",
				"flow": "signIn",
				"flow_version": "a5f84c24-be6e-4dbe-af76-91735a17f0c0",
				"form": "userInformationForm",
				"js_version": "63fc518",
				"locale": "en-US",
				"redirect_uri": "http://www.mycokerewards.com",
				"response_type": "token",
				"settings_version": "",
				"traditionalSignIn_emailAddress": self._username,
				"traditionalSignIn_password": self._password,
				"traditionalSignIn_signInButton": "Sign In",
				"utf8": "✓"
			}
		}, function(err, response, body) {
			if(err || response.statusCode != 200) {
				callback("Couldn't login: " + (error || "HTTP status " + response.statusCode) + ". Dump to " + self._dumpResponse(response));
				return;
			}
			
			self._debug("Getting login details for transaction");
			self._request("https://coca-cola.janraincapture.com/widget/get_result.jsonp?transactionId=" + txid + "&cache=" + Date.now(), function(err, response, body) {
				if(err || response.statusCode != 200) {
					callback("Couldn't login: " + (err || "HTTP status " + response.statusCode) + ". Dump to " + self._dumpResponse(response));
					return;
				}
				
				if(!body.match(/"stat":"ok"/)) {
					callback("Couldn't login: stat is not ok. Dump to " + self._dumpResponse(response));
					return;
				}
				
				var token = body.match(/"accessToken":"([^"]+)"/);
				if(!token) {
					if(body.indexOf('"status":"error","statusMessage":"rateLimitExceeded"') != -1) {
						callback("Couldn't login: rate-limited. Dump to " + self._dumpResponse(response));
						self._rateLimitExpire = Date.now() + (1000 * 60 * 10);
					} else {
						callback("Couldn't login: no token found. Dump to " + self._dumpResponse(response));
					}
					
					return;
				}
				
				self._debug("Signing in with access token " + token[1]);
				self._request("http://www.mycokerewards.com/account/sign-in?accessToken=" + token[1] + "&provider=janrain", function(err, response, body) {
					if(err || response.statusCode >= 400) {
						callback("Couldn't login: " + (err || "HTTP status " + response.statusCode) + ". Dump to " + self._dumpResponse(response));
						return;
					}
					
					callback();
				});
			});
		});
	});
};
