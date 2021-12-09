const socketServer = config.socketServer || "https://localhost:8080";
const debug = config.debug || false; //TODO - add a querystring 
let socket
let this_client_id;
let el = {};
let clients = {};
let identity;
let ctx; //canvas context. 
let consoleElement;
let mouse = {
    x: 0,
    y: 0
}


window.onload = async () => {
    identity = document.querySelector("body").getAttribute("id");
    el.canvas = document.querySelector("#canvas");
    el.container = document.querySelector("#canvas_container");
    el.console = document.querySelector("#console");
    el.resetButton = document.querySelector("#reset_button");
    //setupConsole();

    setupCanvas();
    resizeCanvas();
    initSocketConnection();
};

window.onresize = () => {
    resizeCanvas();
}


const resizeCanvas = () => {
    console.log("resizingcanvas");
    el.canvas.width = el.canvas.offsetWidth;
    el.canvas.height = el.canvas.offsetHeight;
};


const addToConsole = (_string) => {
    el.consoles.innerHTML += "<br>" + _string;
}


const setupConsole = () => {

    if (debug && "console" in window) {
        methods = [
            "log", "assert", "clear", "count",
            "debug", "dir", "dirxml", "error",
            "exception", "group", "groupCollapsed",
            "groupEnd", "info", "profile", "profileEnd",
            "table", "time", "timeEnd", "timeStamp",
            "trace", "warn"
        ];

        generateNewMethod = function (oldCallback, methodName) {
            return function () {
                var args;
                addToConsole(methodName + ":" + arguments[0]);
                args = Array.prototype.slice.call(arguments, 0);
                Function.prototype.apply.call(oldCallback, console, arguments);
            };
        };

        for (i = 0, j = methods.length; i < j; i++) {
            cur = methods[i];
            if (cur in console) {
                old = console[cur];
                console[cur] = generateNewMethod(old, cur);
            }
        }

    }
}

function addIdentityToClients(user) {
    for (let i = 0; i < Object.keys(clients).length; i++) {
        if (Object.keys(clients)[i] == user.id) {
            clients[user.id].identity = user.identity;
        }
    };
}


function initSocketConnection() {
    console.log("attempting connection to " + socketServer);
    socket = io(socketServer, { secure: true });
    socket.on("connect", () => {
        console.log("socket.io connected to " + socketServer);
    });

    socket.on("connect_failed", (e) => {
        console.log("connect_failed");
    });

    socket.on("error", (e) => {
        console.log("error: " + e);
    });

    socket.on("introduction", (payload) => {
        this_client_id = payload.id;
        for (let i = 0; i < payload.clients.length; i++) {
            if (payload.clients[i] != this_client_id) {
                addClient(payload.clients[i]);

            }
        };

        socket.on("identity-declared", (payload) => {
            //check for 
        });

        socket.on("newUserConnected", (payload) => {
            let alreadyHasUser = false;

            for (let i = 0; i < Object.keys(clients).length; i++) {
                if (Object.keys(clients)[i] == payload.id) {
                    alreadyHasUser = true;
                    break;
                }
            }

            if (payload.id != this_client_id && !alreadyHasUser) {
                addClient(payload.id);
            } else {
                declareIdentity(identity);
            }

        });

        socket.on("userDisconnected", (payload) => {
            if (payload.id != this_client_id) {
                delete clients[payload.id];
            }
        });

        socket.on("messageSent", (payload) => {
            const messagingUser = findUserInRoom(payload.id);
            if (messagingUser != null) {
                if (messagingUser.identity != identity) {
                    if (room[messagingUser.identity] != null) {
                        room[messagingUser.identity].message = payload.message;
                        updateRoomMessages();
                    }
                }
            }
        });

        socket.on("onMouseMove", (payload) => {
            onPaint(payload.x, payload.y);
        });
    });
}


function setupCanvas() {
    ctx = el.canvas.getContext('2d');
    ctx.lineWidth = 20;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    el.canvas.addEventListener('pointerdown', (e) => {
        mouse.x = e.pageX - el.canvas.offsetLeft;
        mouse.y = e.pageY - el.canvas.offsetTop;
        //ctx.beginPath();
        ctx.moveTo(mouse.x, mouse.y);
        el.canvas.addEventListener('pointermove', onPointerPaint, false);
    }, false);


    el.canvas.addEventListener('pointerup', () => {
        //ctx.closePath;
        el.canvas.removeEventListener('pointermove', onPointerPaint, false);
    }, false);


    el.canvas.addEventListener

    const onPointerPaint = (e) => {
        mouse.x = e.pageX - el.canvas.offsetLeft;
        mouse.y = e.pageY - el.canvas.offsetTop;
        socket.emit("mouseMove", {
            identity,
            x: mouse.x,
            y: mouse.y,
            id: this_client_id
        });
        onPaint(mouse.x, mouse.y);
    };

    el.resetButton.addEventListener("click", (e) => {
        e.preventDefault();
        socket.emit("message", {
            identity,
            message: "clear",
            id: this_client_id
        });
        clearCanvas();
    });
}

function clearCanvas() {
    ctx.closePath;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
}


function onPaint(x, y) {
    ctx.lineTo(x, y);
    ctx.stroke();
}

function declareIdentity(identity) {
    socket.emit("declare-identity", {
        identity,
        message: "browser version of " + identity + " connected",
        id: this_client_id,
    });
}

function addClient(_id) {
    console.log("adding client with _id " + _id);
    clients[_id] = {};
    clients[_id].id = _id;
}

