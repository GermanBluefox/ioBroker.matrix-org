"use strict";

const { assert } = require("assertthat");

const standard = require("../lib/standard.js");

const PNG =
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACmSURBVFhH7ZdhCoAgDEZnd9D737T8xJkNNY1Ef+yB2LTcC1qWOT20kCBgjIkh0WwfmeuIxyGYnRzIPElgFSqgAvsKOOdCzeZ1y7EcZzDG16HvwtckihLdA4xxk3HeGGttc17Cc+lN6Ds/dlO6w6/ItQHn7H4GcDK3Em/zNboE5KKjcQstQxVQARVYLlDdC2YzvBfMQgVUYB8BlMWfn2E1ZJ7Fv+dEF0UZoNhXp9NnAAAAAElFTkSuQmCC";

suite("standard commands", () => {
    test("getRecipients names the room of the settings", done => {
        assert.that(standard.roomRecipients("!abc:matrix.org", "#home:matrix.org")).is.equalTo([
            { id: "!abc:matrix.org", name: "#home:matrix.org", kind: "chat", default: true },
        ]);
        // before the login only the alias is known
        assert.that(standard.roomRecipients("", "#home:matrix.org")[0].id).is.equalTo("#home:matrix.org");
        done();
    });
    test("recipient: the room by id, alias or name, anything else NOT_FOUND", done => {
        for (const recipient of [undefined, "", "!ABC:matrix.org", "#home:matrix.org", "Home"]) {
            assert.that(standard.checkRecipient(recipient, "!abc:matrix.org", "#home:matrix.org")).is.null();
        }
        const refused = standard.checkRecipient("Anna", "!abc:matrix.org", "#home:matrix.org");
        assert.that(refused.reason).is.equalTo("NOT_FOUND");
        assert.that(refused.candidates).is.equalTo(["#home:matrix.org"]);
        done();
    });
    test("ask lists the answers and finds the index of a reply", done => {
        assert.that(standard.askBody("Close?", ["yes", "no"])).is.equalTo("Close?\n1. yes\n2. no");
        assert.that(standard.askBody("How are you?", [])).is.equalTo("How are you?");
        assert.that(standard.askAnswer(" 2 ", ["yes", "no"], "@a:x")).is.equalTo({ answer: "no", index: 1, from: "@a:x" });
        assert.that(standard.askAnswer("YES", ["yes", "no"], "@a:x")).is.equalTo({ answer: "yes", index: 0, from: "@a:x" });
        assert.that(standard.askAnswer("later", ["yes", "no"], "@a:x")).is.equalTo({ answer: "later", from: "@a:x" });
        assert.that(standard.askAnswer("3", ["yes", "no"], "@a:x")).is.equalTo({ answer: "3", from: "@a:x" });
        done();
    });
    test("loadFile reads the file forms of the catalog", async () => {
        const fromData = await standard.loadFile({ data: PNG, contentType: "image/png" });
        assert.that(fromData.type).is.equalTo("image/png");
        assert.that(fromData.buffer.length > 100).is.true();

        assert.that((await standard.loadFile(`data:image/png;base64,${PNG}`)).type).is.equalTo("image/png");
        assert.that((await standard.loadFile({ type: "image/png", base64: PNG })).type).is.equalTo("image/png");
        assert.that((await standard.loadFile(PNG, "image/x-test")).type).is.equalTo("image/x-test");
        // without a type the PNG is recognized from its data
        assert.that((await standard.loadFile({ data: PNG })).type).is.equalTo("image/png");

        const asked = [];
        const readFile = async (id, name) => {
            asked.push([id, name]);
            return { file: Buffer.from(PNG, "base64"), mimeType: "image/png" };
        };
        const fromFiles = await standard.loadFile("iobfile://frigate.0/snapshots/door.png", undefined, readFile);
        assert.that(asked).is.equalTo([["frigate.0", "snapshots/door.png"]]);
        assert.that(fromFiles.type).is.equalTo("image/png");

        let error;
        try {
            await standard.loadFile("no file");
        } catch (err) {
            error = err;
        }
        assert.that(error).is.not.undefined();
    });
});
