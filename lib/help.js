'use strict';

/*
 * The answer of the command "help": what the instance answers, written for AI agents (e.g. ioBroker.pi-agent, or the
 * MCP server with "send_to") and script authors. Keep it in sync with onMessage() in main.js and the README.
 */

/**
 * The commands onMessage() answers; write = the command has an effect (sends a message);
 * standard = the command of the shared catalog of ioBroker.assistant (HELP.md) it follows
 */
export const COMMANDS = [
    { command: 'help', write: false },
    { command: 'send', write: true, standard: 'message.send' },
    { command: 'ask', write: true, standard: 'message.ask' },
    { command: 'getRecipients', write: false, standard: 'message.getRecipients' },
];

export const HELP = `ioBroker.matrix-org: a bot user that sends messages, pictures and files into one Matrix room
(the room of the settings; one instance per room) and shows the last text message of the other members of that
room. An agent can send a text, an HTML message or a file into that room and ask a question there.
send, ask and getRecipients follow the shared catalog of message commands (message.send, message.ask,
message.getRecipients).

Commands (sendTo matrix-org.0):
- send {text, title?, html?, file?, files?, contentType?, recipient?}: sends into the room. text ({message} or
  {body} work as well); title: put as first line (bold with html). html: HTML as the Matrix spec allows it (e.g.
  <h1>, <b>, <table>), text = the plain text for clients that cannot show HTML (give both). file (one) or files (a
  list): a picture, video or other file as "data:image/png;base64,...", {data, contentType} (base64, as
  camera.snapshot answers), base64 with contentType, {type: "image/png", base64: "..."},
  "iobfile://<adapter>.<n>/<path>" (the files of ioBroker), an http(s) URL (the adapter downloads it) or a path on
  the ioBroker host as "file:///opt/pic.png" (Windows "file:///C:/pic.png"). contentType (or type): the MIME type
  when the file does not say it; without it only PNG, GIF and JPEG are recognized. image/* is shown as a picture,
  video/* as a video, anything else as a file. recipient: only the room of the settings (see getRecipients).
  Answer when sent: {ok: true, sent: 1, id: <event id>} or {error, reason?} (reason BAD_REQUEST: nothing to send,
  NOT_CONNECTED: the bot is not logged in, NOT_FOUND: another room).
  A plain string as message is sent as text and answered at once with the string "Message computed" (old form,
  not waited for). sendTo("matrix-org.0", "Hello") without a command means send.
- ask {text, answers?, timeoutSec?, recipient?}: sends the question into the room and waits for the next text
  message of another member; answers (texts) are listed with numbers below the question, a reply with a number or
  an answer text gives its index. timeoutSec default 60; the sendTo of the caller must wait longer.
  Answer {answer, index?, from: <user id>}, {timeout: true} or {error, reason?}.
- getRecipients {}: the room of the settings. Answer {recipients: [{id: <room id>, name: <room alias>, kind:
  "chat", default: true}]}.

States (matrix-org.0.*): sendMessage: a text written there (ack false) is sent to the room (the text "image"
sends a test picture). receiveMessage: the last text message of another member of the room. info.connection:
true when the bot is logged in.

How to talk to the user:
- Every member of the room reads the messages. Send or ask only what the user asked for; if the room has other
  people than the user, sending there needs the user's explicit request. With several instances (rooms) and no
  room named, ask which one.
- Tell the user whether the message was sent; on {error} say why (e.g. the bot is not logged in).`;
