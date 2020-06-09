const mysql = require('mysql2/promise');

class MySQLSession {
	constructor (options, connection) {
		this.options = Object.assign({
			property: 'session',
			userProperty: '',
			chatProperty: '',
			table: 'sessions',
			interval: 300000,
			lifetime: 300,
			getSessionKey: (ctx) => {
				if (ctx.updateType === 'callback_query') {
					ctx = ctx.update.callback_query.message;
				}
				if (!ctx.from || !ctx.chat) {
					return;
				}
				return [ctx.from.id, ctx.chat.id];
			}
		}, options);
		
		this.sessions = {};
		this.sessionsDts = {};

		this.client = mysql.createPool(connection);
		
		this.client.execute('CREATE TABLE IF NOT EXISTS `' + this.options.table + '` (`user_id` bigint(20) NOT NULL,`chat_id` bigint(20) NOT NULL,`session` JSON NOT NULL,UNIQUE KEY `user_id` (`user_id`,`chat_id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8;').then(([rows,fields]) => {
		}).catch(console.log);
		
		this.interval = setInterval(() => {
			var currnet_time = Math.floor(new Date() / 1000);
			
			Object.keys(this.sessionsDts).forEach((key) => {
				if (currnet_time - this.sessionsDts[key] >= this.options.lifetime) {
					delete this.sessions[key];
					delete this.sessionsDts[key];
				}
			});
		}, this.options.interval);
	}

	async getSession (user_id, chat_id) {
		const key = user_id + ':' + chat_id;
		
		if (!this.sessions[key]) {
			let [rows] = await this.client.query('SELECT `session` FROM `' + this.options.table + '` WHERE `user_id` = "' + user_id + '" AND `chat_id` = "' + chat_id + '"');
			
			if (rows && rows.length) {
				this.sessions[key] = rows[0].session;
			} else {
				this.sessions[key] = {};
			}
			
			this.sessionsDts[key] = Math.floor(new Date() / 1000);
		}
		
		return this.sessions[key];
	}

	async saveSession (user_id, chat_id, session) {
		if (!session || Object.keys(session).length === 0) {
			return await this.client.query('DELETE FROM `' + this.options.table + '` WHERE `user_id` = "' + user_id + '" AND `chat_id` = "' + chat_id + '"');
		}

		const sessionString = JSON.stringify(session);
		
		return await this.client.query("INSERT INTO `" + this.options.table + "` (`user_id`, `chat_id`, `session`) VALUE ('" + user_id + "', '" + chat_id + "', '" + sessionString + "') ON DUPLICATE KEY UPDATE `session` = '" + sessionString + "';");
	}
	
	destroy() {
		this.client.end();
		this.client = null;
		
		delete this.options;
		this.options = null;
		
		clearInterval(this.interval);
		this.interval = null;
		
		delete this.sessions;
		this.sessions = null;
		
		delete this.sessionsDts;
		this.sessionsDts = null;
	}

	middleware () {
		return async (ctx, next) => {
			const [user_id, chat_id] = this.options.getSessionKey(ctx);
			
			if (!user_id || !chat_id) {
				return next();
			}
			
      let session = null;
			if (this.options.property) {
        session = await this.getSession(user_id, chat_id);
        
        Object.defineProperty(ctx, this.options.property, {
          get: function () { 
            return session;
          },
          set: function (newValue) { 
            session = Object.assign({}, newValue) ;
          }
        });
      }
			
			let userSession = null;
			
			if (this.options.userProperty) {
				userSession = await this.getSession(user_id, 0);
				
				Object.defineProperty(ctx, this.options.userProperty, {
					get: function () { 
						return userSession;
					},
					set: function (newValue) { 
						userSession = Object.assign({}, newValue) ;
					}
				});
			}
			
			let chatSession = null;
			
			if (this.options.chatProperty) {
				chatSession = await this.getSession(0, chat_id);
				
				Object.defineProperty(ctx, this.options.chatProperty, {
					get: function () { 
						return chatSession;
					},
					set: function (newValue) { 
						chatSession = Object.assign({}, newValue) ;
					}
				});
			}
			
			await next();
			
      if (session) {
        await this.saveSession(user_id, chat_id, session);
      }
			if (userSession) {
				await this.saveSession(user_id, 0, userSession);
			}
			if (chatSession) {
				await this.saveSession(0, chat_id, chatSession);
			}
			return;
		}
	}
}

module.exports = MySQLSession;
