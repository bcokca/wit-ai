var fetch = require('node-fetch');
var Wit = require('node-wit/lib/wit');
var express = require('express');
var bodyParser = require('body-parser');
var firebase = require('firebase');
var uuid = require('node-uuid');

var WIT_TOKEN = 'YHAO664NCDCREMFRSH2OJ5PVY62GL22D';
var PAGE_TOKEN = 'EAAShMI0CdhgBAEzpKayA0JYdgwNKwnifktaZBD1iJcmUOVFMBu08k08x135r442vKBWv7xYZBrquo9SFnfEeqzf0ZAZAhHEKrQkQ3KKGQTVBRG4fQYbJsPXYDoPW1uSDCnjVg2991vPq21XOkX0KYnzWx5yXZBf0p1zsaGPgOLgZDZD';

var app = express();
app.use(bodyParser.json());

// ------------------------------------------------------------
// FB Integration

var MESSAGES_PATH = 'https://graph.facebook.com/v2.6/me/messages';

function sendMessage(payload) {
    console.log('-> sendMessage', payload);
    return fetch(MESSAGES_PATH + '?access_token=' + PAGE_TOKEN, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
    }).then(x => x.json())
        .then(json => console.log('sendMessage -> ', json))
}

// ------------------------------------------------------------
// Manage Session

var _sessions = {};

var MAX_SESSION_PAUSE = 60 * 5 * 1000;

function getSession(senderId) {
    let session = _sessions[senderId];
    if (
        !session ||
        (Date.now() - session.lastMessageAt) > MAX_SESSION_PAUSE
    ) {
        _sessions[senderId] = {
            id: uuid.v4(),
            lastMessageAt: Date.now(),
            context: {}
        };
    }
    return _sessions[senderId];
}

function setSession(senderId, session) {
    _sessions[senderId] = session;
}


// ------------------------------------------------------------
// API

function textMessages(body) {
    let messaging = (
        body && body.entry && body.entry[0] && body.entry[0].messaging
    );
    return messaging && messaging.filter(
            x => x.message && x.message.text) || [];
}

app.post('/fb', function (req, res) {
    console.log('body', req.body);
    res.status(200).send();
    textMessages(req.body).map(handleMessage);
});

function handleMessage(messageBody) {
    let sender = messageBody.sender;
    let message = messageBody.message;
    console.log('[fb] message', messageBody);
    let engine = new Wit({
        accessToken: WIT_TOKEN,
        actions: wrapActions(sender.id)
    });
    let session = getSession(sender.id);
    engine.runActions(
        session.id,
        message.text,
        session.context
    ).then(
        function (newContext) {
            let newSession = Object.assign(session, {context: newContext});
            setSession(sender.id, newSession);
        },
        function (err) {
            console.log('error', sender, message, err, err.stack);
            sendMessage({
                recipient: {id: sender.id},
                message: {
                    text: 'There was an error with witty-fiddle. please contact the team'
                }
            });
        }
    );
}

app.get('/fb', function (req, res) {
    if (req.query['hub.verify_token'] === WIT_TOKEN) {
        res.send(req.query['hub.challenge']);
        return;
    }
    res.status(400).send('uh oh : /');
});


app.listen(process.env.PORT || 5000);

// ------------------------------------------------------------
// Actions

function mapObject(obj, f) {
    return Object
        .keys(obj)
        .map(k => [k, f(obj[k], k)])
        .reduce(
            (newObj, [k, v]) => {
                newObj[k] = v;
                return newObj;
            },
            {}
        )
        ;
}

function createActions() {
    let window = {};

    let integration = {
        messengerSend: sendMessage,
        firebase
    };

    let require = (k) => {
        if (integration[k]) {
            return integration[k]
        } else {
            throw new Error(k + ' is not a valid require.');
        }
    };

    var actions = (function () {
        // --> Code from fiddle
        /**
         * Created by bcokca on 12/27/16.
         */
        var messengerSend = require('messengerSend');
        var firebase = require('firebase');

        // ------------------------------------------------------------
        // Actions

        var actions = {
            send: send,
            fetchWeather: fetchWeather,
            sendWeatherBubble: sendWeatherBubble,
            TurnHeaterOn: TurnHeaterOn,
            TurnHeaterOff: TurnHeaterOff
        };

        function TurnHeaterOff(request) {
            let context = request.context;
            let entities = request.entities;
            let on_off = firstEntityValue(entities, 'on_off');

            delete context.response;

            context.response = 'Turning the Heater Off:  on_off= ' + on_off;
            return context;
        }

        function TurnHeaterOn(request) {
            let context = request.context;
            let entities = request.entities;
            let on_off = firstEntityValue(entities, 'on_off');

            delete context.response;

            context.response = 'Turning the Heater On: on_off= ' + on_off;
            return context;
        }

        function send(request, response) {
            let message = {};
            if (response.text) {
                message.text = response.text;
            }
            if (response.quickreplies) {
                message.quick_replies = response.quickreplies.map(
                    function (reply) {
                        return {
                            content_type: 'text',
                            title: reply,
                            payload: reply,
                        };
                    }
                )
            }
            messengerSend({
                recipient: {id: request.fbid},
                message: message,
            });
        }

        // Example of an asynchronous function, using promises
        function fetchWeather(request) {
            let context = request.context;
            let entities = request.entities;
            let location = firstEntityValue(entities, 'location');

            delete context.forecast;
            delete context.missingLocation;
            delete context.location;

            if (location) {
                context.location = location;
                return fetch(
                    'https://api.apixu.com/v1/forecast.json?' +
                    'key=8d1bc0ace03d457ca9b164802162808' +
                    '&q=' + location
                )
                    .then(function (response) {
                        return response.json();
                    })
                    .then(function (responseJSON) {
                        context.forecast = responseJSON.current.temp_f + ' F';
                        return context;
                    });
            } else {
                context.missingLocation = true;
                return context;
            }
        }

        var WEATHER_IMAGE_URL = 'http://www.marciholliday.com/briefcase/115574_826201413016PM90056.png';

        // Example of a synchronous function, not using promises for simplicity
        function sendWeatherBubble(request) {
            let context = request.context;
            let fbid = request.fbid;
            messengerSend({
                recipient: {id: fbid},
                message: {
                    attachment: {
                        type: 'template',
                        payload: {
                            template_type: 'generic',
                            elements: [{
                                title: 'Weather in ' + context.location,
                                image_url: WEATHER_IMAGE_URL,
                                "subtitle": context.forecast,
                            }]
                        }
                    }
                }
            });
            return context;
        }

        // ------------------------------------------------------------
        // Helpers

        function firstEntityValue(entities, name) {
            let val = entities && entities[name] &&
                Array.isArray(entities[name]) &&
                entities[name].length > 0 &&
                entities[name][0].value;
            if (!val) {
                return null;
            }
            return typeof val === 'object' ? val.value : val;
        }

        // <-- Code from fiddle

        return actions;
    })();

    return actions;
}

var actions = createActions();

function wrapActions(senderId) {
    return mapObject(
        actions,
        (f, k) => (request, ...rest) => {
            let withId = Object.assign(request, {fbid: senderId});
            return f(withId, ...rest);
        }
    );
}