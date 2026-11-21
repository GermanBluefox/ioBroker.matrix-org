'use strict';

/*
 * The commands of the shared catalog of ioBroker.assistant (HELP.md, family "message"): message.send,
 * message.getRecipients and message.ask, for the one room of an instance. Pure functions, used by main.js.
 */

import * as fs from 'node:fs';
import * as helper from './helper.js';

/** Seconds message.ask waits for an answer by default */
export const ASK_TIMEOUT_SEC = 60;

/**
 * A text of the caller, or '' for anything that is no text
 *
 * @param value text, number or boolean
 * @returns the text
 */
export function textOf(value) {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

/**
 * The recipients of message.getRecipients: the room of the settings
 *
 * @param roomId the id of the room (empty before the login)
 * @param roomName the alias of the room of the settings, e.g. "#home:matrix.org"
 * @returns the recipients
 */
export function roomRecipients(roomId, roomName) {
    return [{ id: roomId || roomName, name: roomName || roomId, kind: 'chat', default: true }];
}

/**
 * Check the recipient of a request: only the room of the settings, by id, alias or the name of the alias
 *
 * @param recipient the recipient of the caller (empty = the room of the settings)
 * @param roomId the id of the room
 * @param roomName the alias of the room of the settings
 * @returns null if it is the room, else the answer
 */
export function checkRecipient(recipient, roomId, roomName) {
    const wanted = textOf(recipient).trim().toLowerCase();
    if (!wanted) {
        return null;
    }
    const alias = String(roomName || '').toLowerCase();
    const names = [String(roomId || '').toLowerCase(), alias, alias.replace(/^#/, '').replace(/:.*$/, '')];
    if (names.includes(wanted)) {
        return null;
    }
    return {
        error: `Unknown recipient "${textOf(recipient)}": this instance writes only into ${roomName || roomId}`,
        reason: 'NOT_FOUND',
        candidates: [roomName || roomId],
    };
}

/**
 * The text of the question of message.ask: Matrix has no buttons here, the answers are listed with numbers
 *
 * @param text the question
 * @param answers the possible answers
 * @returns the text to send
 */
export function askBody(text, answers) {
    return answers.length ? `${text}\n${answers.map((answer, i) => `${i + 1}. ${answer}`).join('\n')}` : text;
}

/**
 * The answer of message.ask for a reply: an answer of the list (by its number or its text) gets its index
 *
 * @param reply the text of the reply
 * @param answers the possible answers
 * @param from the user id of the sender
 * @returns the answer for the caller
 */
export function askAnswer(reply, answers, from) {
    const text = String(reply).trim();
    const number = /^\d+$/.test(text) ? Number(text) - 1 : -1;
    const index =
        number >= 0 && number < answers.length
            ? number
            : answers.findIndex(answer => answer.toLowerCase() === text.toLowerCase());
    return index >= 0 ? { answer: answers[index], index, from } : { answer: text, from };
}

/**
 * Read a file of the caller: a data URL, base64 with contentType, {data, contentType} (as camera.snapshot answers),
 * {base64, type}, an iobfile:// path, an http(s) URL or a file:// path on the host
 *
 * @param value the file
 * @param contentType the MIME type, if known
 * @param readFile reads a file of the ioBroker file storage: (id, name) => Promise<{file, mimeType}>
 * @returns the content and its MIME type
 */
export async function loadFile(value, contentType, readFile) {
    let buffer;
    let type = contentType ? String(contentType) : undefined;
    if (value && typeof value === 'object' && typeof value.data === 'string') {
        buffer = Buffer.from(value.data, 'base64');
        type = value.contentType ? String(value.contentType) : type;
    } else if (value && typeof value === 'object' && value.base64) {
        const data = helper.getBufferAndNameFromBase64Object(value);
        buffer = data.buffer;
        type = data.mimeType || type;
    } else if (typeof value !== 'string' || !value) {
        throw new Error('file must be a data URL, base64 with contentType, {data, contentType}, iobfile:// or a URL');
    } else if (value.startsWith('data:')) {
        const data = helper.getBufferAndNameFromBase64String(value);
        if (!data) {
            throw new Error('file is no base64 data URL');
        }
        buffer = data.buffer;
        type = data.mimeType;
    } else if (value.startsWith('iobfile://')) {
        const [id, ...name] = value.substring('iobfile://'.length).split('/');
        const data = await readFile(id, name.join('/'));
        buffer = Buffer.isBuffer(data.file) ? data.file : Buffer.from(data.file);
        type = data.mimeType || type;
    } else if (value.startsWith('https://') || value.startsWith('http://')) {
        const response = await fetch(value);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        type = response.headers.get('content-type') || type;
        buffer = Buffer.from(await response.arrayBuffer());
    } else if (value.startsWith('file://')) {
        buffer = fs.readFileSync(helper.isWindows() && value.startsWith('file:///') ? value.slice(8) : value.slice(7));
    } else if (type) {
        buffer = Buffer.from(value, 'base64');
    } else {
        throw new Error('file must be a data URL, base64 with contentType, {data, contentType}, iobfile:// or a URL');
    }
    if (!type) {
        try {
            type = helper.getFileTypeFromData(buffer);
        } catch {
            type = '';
        }
    }
    return { buffer, type: type && type !== 'unknown' ? type : 'application/octet-stream' };
}
