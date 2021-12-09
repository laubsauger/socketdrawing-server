// express server
const fs = require('fs');
const express = require("express");
const app = express();
app.use(express.static("public"));

options = {
    key: fs.readFileSync('certs/server.key'),
    cert: fs.readFileSync('certs/server.crt')
};

var port;
var io;

let clientIndex = 0;

let clients = {};

async function main() {
    await setupHttpsServer();
    setupSocketServer();
}
main();

async function setupHttpsServer() {
    var https = require('https');
    port = process.env.PORT || 8080;

    var serverHttps = https.createServer(options, app).listen(port, () => {
        console.log("listening on " + port);
    });

    io = require("socket.io")({
        cors: true
    }).listen(serverHttps);
}


function setupSocketServer() {
    console.log("setting up socket server");
    io.on("connection", (client) => {

        let thisClientIndex = clientIndex;
        clientIndex++;

        console.log("User " + client.id + " connected. Assigning index: " + thisClientIndex);

        clients[client.id] = {
            id: client.id,
            client_index: thisClientIndex,
        };

        client.emit(
            "introduction",
            {
                id: client.id,
                client_index: thisClientIndex,
                clients: Object.keys(clients)
            }
        );

        io.sockets.emit(
            "newUserConnected",
            {
                id: client.id,
                client_index: thisClientIndex,
                clients: Object.keys(clients),
            }
        );

        client.on("disconnect", () => {
            delete clients[client.id];
            io.sockets.emit(
                "userDisconnected",
                {
                    id: client.id,
                    client_index: thisClientIndex,
                    clients: Object.keys(clients)
                }
            );

            console.log(
                "User " + client.id + "(" + thisClientIndex + ") disconnected"
            );
        });

        client.on("connect_failed", (err) => {
            console.log("connect failed!", err);
        });

        client.on("error", (err) => {
            console.log("there was an error on the connection!", err);
        });

        client.on("declare-identity", (data) => {
            io.sockets.emit(
                "identity-declared",
                {
                    client_index: thisClientIndex,
                    ...data
                }
            );
        });

        client.on("mouseMove", (data) => {
            client.broadcast.emit(
                "onMouseMove",
                {
                    client_index: thisClientIndex,
                    ...data
                }
            );
        });

        client.on("message", (data) => {
            io.sockets.emit(
                "onMessage",
                {
                    client_index: thisClientIndex,
                    ...data
                }
            );
        });
    });
}