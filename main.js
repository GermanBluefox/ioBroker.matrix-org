'use strict';

/*
 * Created with @iobroker/create-adapter v2.1.1
 */

import * as fs from 'node:fs';
import * as helper from './lib/helper.js';
import { COMMANDS, HELP } from './lib/help.js';
import * as standard from './lib/standard.js';

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from '@iobroker/adapter-core';
import * as matrix from 'matrix-js-sdk';
import * as url from 'node:url';

// the client for matrix communication
let matrixClient;
// local variable for fast access to static data
let fullUserId = '';
let roomId = '';
class MatrixOrg extends utils.Adapter {
    /**
     * class for matrix adapter
     *
     * @param [options] unused here just tunneled
     */
    constructor(options) {
        super({
            ...options,
            name: 'matrix-org',
        });
        // open questions of message.ask, the oldest first
        this.pendingAsks = [];
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    /**
     * is called as part of the login chain to big for inline
     *
     * @param data contain the return data with room_id if valid
     */
    async matrixRoomIdResponse(data) {
        if (data) {
            this.setState('matrixServerData.roomId', data.room_id, true);
            roomId = data.room_id;
            const loginData = { user: this.config.botName, password: this.config.botPassword };
            const storedDeviceId = await this.getState('matrixSession.deviceId');
            if (storedDeviceId && storedDeviceId.val) {
                loginData.device_id = storedDeviceId.val;
            }
            loginData.initial_device_display_name = this.config.deviceName || 'ioBroker';
            matrixClient
                .login('m.login.password', loginData)
                .then(data => this.matrixLoginResponse(data))
                .catch(err => this.matrixLoginResponseErr(err));
        }
    }
    /**
     * is called as part of the login chain to big for inline
     *
     * @param err contain the error data for debuging
     */
    async matrixRoomIdResponseErr(err) {
        if (err) {
            this.log.error('Server or room not found. Check port (443/8448), room name and server.');
            this.log.error(JSON.stringify(err));
        }
    }
    /**
     * is called of last state of the login chain, Crypto disabled due to malfunction
     *
     * @param data contain the login data
     */
    async matrixLoginResponse(data) {
        if (data) {
            fullUserId = data.user_id;
            await this.setState('matrixSession.userId', data.user_id, true);
            await this.setState('matrixSession.deviceId', data.device_id, true);
            await this.setState('matrixSession.accessToken', data.access_token, true);
            try {
                await this.startMatrixClient();
            } catch (err) {
                this.log.error(err);
            }
        }
    }
    /**
     * starts the matrix client and wires up the sync/room/member callbacks,
     * shared by the password-login path and the stored-session path
     */
    async startMatrixClient() {
        await matrixClient.startClient();
        this.log.debug('client started!');
        // init the receive callback
        matrixClient.once('sync', (state, prevState, res) => {
            this.log.debug(`state: ${JSON.stringify(state)}`);
            this.log.debug(`prevState: ${JSON.stringify(prevState)}`);
            this.log.debug(`res: ${JSON.stringify(res)}`);
            try {
                matrixClient.on('Room.timeline', (event, room, toStartOfTimeline) =>
                    this.onMatrixEvent(event, room, toStartOfTimeline),
                );
            } catch (err) {
                this.log.error(err);
            }
        });
        // autologin snippet by matrix-js-sdk
        matrixClient.on('RoomMember.membership', (event, member) => {
            if (this.config.autoJoin === true) {
                if (member.membership === 'invite' && member.userId === fullUserId) {
                    matrixClient.joinRoom(member.roomId).then(() => {
                        this.log.info(`Auto-joined ${member.roomId}`);
                    });
                }
            }
        });
        this.setState('info.connection', true, true);
    }
    /**
     * is called of last state of the login chain, Crypto disabled due to malfunction
     *
     * @param err contain error data for debuging
     */
    async matrixLoginResponseErr(err) {
        if (err) {
            this.log.error('Login has failed. Mostly credentials are wrong.');
            this.log.error(err);
        }
    }
    /**
     * is called on every room event where the bot is in
     *
     * @param event contain the event data of the listening room
     * @param room not used yet
     * @param toStartOfTimeline not used yet
     */
    async onMatrixEvent(event, room, toStartOfTimeline) {
        let messageUsed = false;
        let reason = '';
        this.log.debug(`Event: ${JSON.stringify(event)}`);
        if (event.event.type === 'm.room.message') {
            if (event.event.sender !== fullUserId) {
                if (event.event.content.msgtype === 'm.text') {
                    if (event.event.room_id === roomId) {
                        this.setState('receiveMessage', { val: event.event.content.body, ack: true });
                        messageUsed = true;
                        this.answerAsk(event.event.content.body, event.event.sender);
                    } else {
                        reason = `roomid don't fit: ${event.event.content.room_id} is not the expected ${roomId}`;
                        this.log.debug(`room:${room} toStartOfTimeline${toStartOfTimeline}`);
                    }
                } else {
                    reason = 'message type is not m.text';
                }
            } else {
                reason = 'It was my own message.';
            }
        } else {
            reason = 'type not m.room.message';
        }
        if (messageUsed === false) {
            this.log.debug(`Message ignored due to: ${reason}`);
        }
    }
    /**
     * normalize the message and send it to matrix, only text messages with msgtype m.text are supported here
     *
     * @param input expect a string, number, boolean or an object with the properties text, message or body as string
     */
    async normalizeMessage(input) {
        if (typeof input === 'string') {
            return input;
        } else if (typeof input === 'number' || typeof input === 'boolean') {
            return input.toString();
        } else if (typeof input?.text === 'string') {
            return input.text;
        } else if (typeof input?.message === 'string') {
            return input.message;
        } else if (typeof input?.body === 'string') {
            return input.body;
        }
        this.log.error('Unsupported message type. Only string, number and boolean are supported.');
        throw new Error('Invalid message format: no string body found');
    }

    /**
     * @param message expect a simple string to send to room
     */
    async sendMessageToMatrix(message) {
        try {
            const body = await this.normalizeMessage(message);
            const roomId = await this.getStateAsync('matrixServerData.roomId');
            if (roomId) {
                const state = 'send message to room with access token!';
                try {
                    const data = { body: body, msgtype: 'm.text' };
                    matrixClient.sendEvent(roomId.val, 'm.room.message', data);
                } catch (err) {
                    this.log.error(err);
                    this.log.error(`error during: ${state}`);
                }
            }
        } catch (error) {
            this.log.error(error);
            this.log.error('error during: matrixServerData.roomId');
        }
    }
    /***
     * @param {object} message
     */
    async sendHtmlToMatrix(message) {
        const roomId = await this.getStateAsync('matrixServerData.roomId');
        if (roomId) {
            const state = 'send message with html content to room with access token!';
            try {
                const data = {
                    body: message.text,
                    msgtype: 'm.text',
                    format: 'org.matrix.custom.html',
                    formatted_body: message.html,
                };
                matrixClient.sendEvent(roomId.val, 'm.room.message', data);
            } catch (err) {
                this.log.error(err);
                this.log.error(`error during: ${state}`);
            }
        }
    }
    /**
     * send the file as an image to matrix
     *
     * @param buffer contain the binary data from the image
     * @param fileType mime type of the image
     */
    async sendFileToMatrix(buffer, fileType) {
        try {
            await this.postFileToMatrix(buffer, fileType);
        } catch (err) {
            this.log.error(err);
            this.log.error('Sending of file failed');
        }
    }
    /**
     * upload the file and send it into the room, throws on errors
     *
     * @param buffer contain the binary data from the image
     * @param fileType mime type of the image
     * @returns the event id of the message
     */
    async postFileToMatrix(buffer, fileType) {
        const uploadResponse = await matrixClient.uploadContent(buffer, { rawResponse: false, type: fileType });
        const matrixUrl = uploadResponse.content_uri;
        let msgtype = matrix.MsgType.File;
        let info = {};
        let body = '';
        if (fileType.startsWith('image')) {
            msgtype = matrix.MsgType.Image;
            body = `image.${fileType.split('/')[1]}`;
        } else if (fileType.startsWith('video')) {
            msgtype = matrix.MsgType.Video;
            info = {
                mimetype: fileType,
            };
        }
        const content = {
            msgtype: msgtype,
            url: matrixUrl,
            info: info,
            body: body,
        };
        const response = await matrixClient.sendMessage(roomId, null, content, undefined);
        return response && response.event_id;
    }
    /**
     * send in the form of the shared catalog (message.send {text, recipient?, title?, file?, files?, priority?},
     * also html and the file forms of send), answers when it is sent
     *
     * @param message the message of the caller
     * @returns the answer: ok, sent and id, or error and reason
     */
    async sendStandard(message) {
        const refused = standard.checkRecipient(message.recipient, roomId, this.config.roomName);
        if (refused) {
            return refused;
        }
        const files = [
            ...(message.file ? [message.file] : []),
            ...(Array.isArray(message.files) ? message.files : message.files ? [message.files] : []),
        ];
        const text = standard.textOf(message.text ?? message.message ?? message.body);
        const title = standard.textOf(message.title);
        const html = standard.textOf(message.html);
        if (!text && !html && !files.length) {
            return { error: 'No text or file given', reason: 'BAD_REQUEST' };
        }
        if (!matrixClient || !roomId) {
            return { error: 'The bot is not logged in', reason: 'NOT_CONNECTED' };
        }
        const ids = [];
        try {
            if (text || html) {
                const data = { body: [title, text || html].filter(part => part).join('\n'), msgtype: 'm.text' };
                if (html) {
                    data.format = 'org.matrix.custom.html';
                    data.formatted_body = title ? `<p><b>${escapeHtml(title)}</b></p>${html}` : html;
                }
                ids.push((await matrixClient.sendEvent(roomId, 'm.room.message', data)).event_id);
            }
            for (const file of files) {
                const loaded = await standard.loadFile(file, message.contentType || message.type, (id, name) =>
                    this.readFileAsync(id, name),
                );
                ids.push(await this.postFileToMatrix(loaded.buffer, loaded.type));
            }
        } catch (err) {
            this.log.error(`Cannot send: ${err.message || err}`);
            return { error: String(err.message || err), ...(ids.length ? { id: ids[0] } : {}) };
        }
        return ids[0] ? { ok: true, sent: 1, id: ids[0] } : { ok: true, sent: 1 };
    }
    /**
     * message.ask of the shared catalog: sends the question and waits for the next text of another member
     *
     * @param message the question: text, answers, recipient, timeoutSec
     * @returns the answer: answer, index and from, timeout, or error and reason
     */
    async ask(message) {
        const request = message && typeof message === 'object' ? message : { text: message };
        const text = standard.textOf(request.text);
        if (!text) {
            return { error: 'No text given', reason: 'BAD_REQUEST' };
        }
        const refused = standard.checkRecipient(request.recipient, roomId, this.config.roomName);
        if (refused) {
            return refused;
        }
        if (!matrixClient || !roomId) {
            return { error: 'The bot is not logged in', reason: 'NOT_CONNECTED' };
        }
        const answers = (Array.isArray(request.answers) ? request.answers : []).map(standard.textOf).filter(a => a);
        try {
            const body = standard.askBody(text, answers);
            await matrixClient.sendEvent(roomId, 'm.room.message', { body, msgtype: 'm.text' });
        } catch (err) {
            return { error: String(err.message || err) };
        }
        const seconds = Number(request.timeoutSec) > 0 ? Number(request.timeoutSec) : standard.ASK_TIMEOUT_SEC;
        return new Promise(resolve => {
            const pending = { answers, resolve, timer: null };
            pending.timer = this.setTimeout(() => {
                this.pendingAsks = this.pendingAsks.filter(item => item !== pending);
                resolve({ timeout: true });
            }, seconds * 1000);
            this.pendingAsks.push(pending);
        });
    }
    /**
     * a text of another member of the room answers the oldest open question of message.ask
     *
     * @param body the text
     * @param sender the user id of the sender
     */
    answerAsk(body, sender) {
        const pending = this.pendingAsks.shift();
        if (pending) {
            this.clearTimeout(pending.timer);
            pending.resolve(standard.askAnswer(body, pending.answers, sender));
        }
    }
    /**
     * send file from url or base64 encoded data to matrix as image
     *
     * @param fileObject expect a file to send
     */
    async sendFile(fileObject) {
        this.log.debug(JSON.stringify(fileObject));
        const file = String(fileObject.file);
        const b64dataString = helper.getBufferAndNameFromBase64String(file);
        const b64dataObject = helper.getBufferAndNameFromBase64Object(fileObject.file);
        let fileType;
        let buffer;
        if (b64dataString) {
            this.log.debug('String detected');
            buffer = b64dataString.buffer;
            fileType = b64dataString.mimeType;
        } else if (b64dataObject) {
            this.log.debug('Object detected');
            buffer = b64dataObject.buffer;
            fileType = b64dataObject.mimeType;
        } else if (file.startsWith('https://') || file.startsWith('http://')) {
            try {
                const response = await fetch(file);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                fileType = response.headers.get('content-type');
                this.log.debug(`http mimetype: ${fileType}`);

                const arrayBuffer = await response.arrayBuffer();
                buffer = Buffer.from(arrayBuffer);
            } catch (err) {
                this.log.error(err);
                this.log.error('read from file failed.');
            }
        } else if (file.startsWith('file://')) {
            if (fileObject.type) {
                fileType = fileObject.type;
                this.log.debug(`file filetype: ${fileType}`);
            }
            try {
                let fileName = file.slice(7);
                if (helper.isWindows()) {
                    if (file.startsWith('file:///')) {
                        fileName = file.slice(8);
                    }
                }
                buffer = fs.readFileSync(fileName);
            } catch (err) {
                this.log.error(err);
            }
        } else {
            this.log.error('no matching data found!');
        }
        try {
            if (fileType === undefined) {
                fileType = helper.getFileTypeFromData(buffer);
                this.log.debug(`guessed file type: ${fileType}`);
            } else {
                this.log.debug(`file type: ${fileType}`);
            }
        } catch (error) {
            this.log.error(error);
            this.log.error('getFileType call failed');
        }
        try {
            this.sendFileToMatrix(buffer, String(fileType));
        } catch (err) {
            this.log.error(err);
            this.log.error('Send file failed!');
        }
    }
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.unloaded = false;
        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);

        // message will send after a change of the object sendMessage
        this.subscribeStates('sendMessage');
        if (this.config.serverIp === '') {
            this.log.error('No server set!');
        } else {
            try {
                let baseURL = '';
                if (this.config.serverPort === '443') {
                    baseURL = `https://${this.config.serverIp}`;
                } else {
                    baseURL = `https://${this.config.serverIp}:${this.config.serverPort}`;
                }
                // try to reuse a stored session (device_id + access token) to avoid creating a new device on every start
                const storedUserId = (await this.getState('matrixSession.userId'))?.val;
                const storedDeviceId = (await this.getState('matrixSession.deviceId'))?.val;
                const storedAccessToken = (await this.getState('matrixSession.accessToken'))?.val;
                if (storedUserId && storedDeviceId && storedAccessToken) {
                    this.log.info(`Reusing stored matrix session for device ${storedDeviceId}`);
                    matrixClient = matrix.createClient({
                        baseUrl: baseURL,
                        userId: storedUserId,
                        accessToken: storedAccessToken,
                        deviceId: storedDeviceId,
                    });
                    try {
                        const roomData = await matrixClient.getRoomIdForAlias(this.config.roomName);
                        this.setState('matrixServerData.roomId', roomData.room_id, true);
                        roomId = roomData.room_id;
                        fullUserId = storedUserId;
                        await this.startMatrixClient();
                    } catch (err) {
                        this.log.warn(
                            `Stored session not valid anymore, falling back to password login: ${err.message || err}`,
                        );
                        await this.setState('matrixSession.accessToken', '', true);
                        await this.setState('matrixSession.deviceId', '', true);
                        await this.setState('matrixSession.userId', '', true);
                        matrixClient = matrix.createClient({ baseUrl: baseURL });
                        matrixClient
                            .getRoomIdForAlias(this.config.roomName)
                            .then(data => this.matrixRoomIdResponse(data))
                            .catch(err2 => this.matrixRoomIdResponseErr(err2));
                    }
                } else {
                    matrixClient = matrix.createClient({ baseUrl: baseURL });
                    matrixClient
                        .getRoomIdForAlias(this.config.roomName)
                        .then(data => this.matrixRoomIdResponse(data))
                        .catch(err => this.matrixRoomIdResponseErr(err));
                }
            } catch (err) {
                this.log.error(err);
                this.log.error(
                    `Server not reached! ${this.config.serverIp}:${this.config.serverPort} with room: ${
                        this.config.roomName
                    }`,
                );
                this.setState('info.connection', false, true);
            }
        }
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback function for shut down
     */
    onUnload(callback) {
        this.unloaded = true;
        for (const pending of this.pendingAsks.splice(0)) {
            this.clearTimeout(pending.timer);
            pending.resolve({ error: 'The adapter stops', reason: 'NOT_CONNECTED' });
        }
        /*eslint no-unused-vars: ["error", { "caughtErrors": "none" }]*/
        try {
            if (matrixClient) {
                matrixClient.stopClient();
            }
            callback();
        } catch (err) {
            this.log.error(err);
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     *
     * @param id of the changed state
     * @param state of the new event
     */
    async onStateChange(id, state) {
        if (state) {
            // The state was changed
            if (state.val) {
                this.log.debug('try send');
                if (state.ack === false) {
                    // This is ioBroker convention, only send commands if ack = false
                    if (state.val === 'image') {
                        this.sendFile({
                            file: {
                                type: 'image/png',
                                base64: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACmSURBVFhH7ZdhCoAgDEZnd9D737T8xJkNNY1Ef+yB2LTcC1qWOT20kCBgjIkh0WwfmeuIxyGYnRzIPElgFSqgAvsKOOdCzeZ1y7EcZzDG16HvwtckihLdA4xxk3HeGGttc17Cc+lN6Ds/dlO6w6/ItQHn7H4GcDK3Em/zNboE5KKjcQstQxVQARVYLlDdC2YzvBfMQgVUYB8BlMWfn2E1ZJ7Fv+dEF0UZoNhXp9NnAAAAAElFTkSuQmCC',
                            },
                        });
                    } else {
                        this.sendMessageToMatrix(state.val.toString());
                    }
                }
            }
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }
    /**
     * Is called if a object is changed
     *
     * @param obj with command and message, will be ignored if not correct type
     */
    onMessage(obj) {
        if (typeof obj === 'object') {
            this.log.debug(JSON.stringify(obj));
            // {"command":"send","message":{"file":"https://sciphy.de/toDownload/test.png"},"from":"system.adapter.javascript.0","_id":12345678}
            // {"command":"send","message":"Hello!","from":"system.adapter.javascript.0","_id":12345678}
            // {"command":"send","message":{"file":{"type":"image/png","base64":"iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACmSURBVFhH7ZdhCoAgDEZnd9D737T8xJkNNY1Ef+yB2LTcC1qWOT20kCBgjIkh0WwfmeuIxyGYnRzIPElgFSqgAvsKOOdCzeZ1y7EcZzDG16HvwtckihLdA4xxk3HeGGttc17Cc+lN6Ds/dlO6w6/ItQHn7H4GcDK3Em/zNboE5KKjcQstQxVQARVYLlDdC2YzvBfMQgVUYB8BlMWfn2E1ZJ7Fv+dEF0UZoNhXp9NnAAAAAElFTkSuQmCC"}},"from":"system.adapter.javascript.0","_id":12345678}
            const reply = answer => obj.callback && this.sendTo(obj.from, obj.command, answer, obj.callback);
            if (obj.command === 'help') {
                // description of all commands for AI agents, also while the bot is not logged in
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, { help: HELP, commands: COMMANDS }, obj.callback);
                }
                return;
            }
            if (obj.command === 'getRecipients') {
                // message.getRecipients of the shared catalog: the room of the settings
                reply({ recipients: standard.roomRecipients(roomId, this.config.roomName) });
                return;
            }
            if (obj.command === 'ask') {
                // message.ask of the shared catalog
                this.ask(obj.message).then(reply);
                return;
            }
            if (obj.command === 'send' && obj.message && typeof obj.message === 'object') {
                // message.send of the shared catalog; a plain string keeps the old answer below
                this.log.debug('send command arrived');
                this.sendStandard(obj.message).then(reply);
                return;
            }
            if (obj.message) {
                if (obj.command === 'send') {
                    this.log.debug('send command arrived');
                    if (obj.message.file) {
                        this.log.debug('file command is triggered!');
                        this.sendFile(obj.message);
                    } else if (obj.message.html) {
                        this.log.debug('html message');
                        this.sendHtmlToMatrix(obj.message);
                    } else {
                        this.log.debug(`send command is triggered!${obj.message}`);
                        if (obj.message) {
                            this.log.debug('message send');
                            this.sendMessageToMatrix(obj.message);
                        }
                        if (obj.callback) {
                            this.log.debug('callback added');
                            this.sendTo(obj.from, obj.command, 'Message computed', obj.callback);
                        }
                    }
                    return;
                }
            }
            reply(
                obj.command === 'send'
                    ? { error: 'No text or file given', reason: 'BAD_REQUEST' }
                    : { error: `Unknown command: ${obj.command}`, reason: 'NOT_SUPPORTED' },
            );
        }
    }
}

/**
 * escape a text for HTML
 *
 * @param text the text
 * @returns the escaped text
 */
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const modulePath = url.fileURLToPath(import.meta.url);
if (process.argv[1] === modulePath) {
    new MatrixOrg();
}
/**
 * Adapter start entry point
 *
 * @param options tunnel options to adapter
 */
export default function startAdapter(options) {
    return new MatrixOrg(options);
}

// testcode for JS scripts in ioBroker
// sendTo("matrix-org.0", "image test filesystem windows!");
// sendTo("matrix-org.0",{file: "file:///C:/tmp/images/test.png"});
// sendTo("matrix-org.0", "image test json!");
// sendTo("matrix-org.0",{file:{type:"image/png",base64:"iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACmSURBVFhH7ZdhCoAgDEZnd9D737T8xJkNNY1Ef+yB2LTcC1qWOT20kCBgjIkh0WwfmeuIxyGYnRzIPElgFSqgAvsKOOdCzeZ1y7EcZzDG16HvwtckihLdA4xxk3HeGGttc17Cc+lN6Ds/dlO6w6/ItQHn7H4GcDK3Em/zNboE5KKjcQstQxVQARVYLlDdC2YzvBfMQgVUYB8BlMWfn2E1ZJ7Fv+dEF0UZoNhXp9NnAAAAAElFTkSuQmCC"}});
// sendTo("matrix-org.0", "image test data!");
// sendTo("matrix-org.0",{file:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACmSURBVFhH7ZdhCoAgDEZnd9D737T8xJkNNY1Ef+yB2LTcC1qWOT20kCBgjIkh0WwfmeuIxyGYnRzIPElgFSqgAvsKOOdCzeZ1y7EcZzDG16HvwtckihLdA4xxk3HeGGttc17Cc+lN6Ds/dlO6w6/ItQHn7H4GcDK3Em/zNboE5KKjcQstQxVQARVYLlDdC2YzvBfMQgVUYB8BlMWfn2E1ZJ7Fv+dEF0UZoNhXp9NnAAAAAElFTkSuQmCC"});
// sendTo("matrix-org.0", "Html!");
// sendTo("matrix-org.0",{html: "<h1>Hello World!</h1>", text: "Hello World!"});
// sendTo("matrix-org.0", "html table");
// sendTo("matrix-org.0",{html: "<table><tr><td>1</td><td>2</td></tr><tr><td>a</td><td>b</td></tr><table>", text: "Your client can not show html!"});
// sendTo("matrix-org.0", "test ready.");
