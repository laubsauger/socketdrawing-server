const express = require('express');
const app = express();
const http = require('http');
const fs = require("fs");
const path = require("path");
const cors = require('cors');
const port = Number(process.env.PORT) || 8080;

const crossOriginDomainsTest = [
  'http://localhost:3000',
  'http://localhost:3001',
];

const crossOriginDomainsProd = [
  'https://osc.link'
];

const headerConfig = (req, res, next) => {
  // allow external requests
  // if (process.env.NODE_ENV === 'production') {
  //   const origin = req.headers.origin;
  //   if (crossOriginDomainsProd.indexOf(origin) > -1) {
  //     res.append('Access-Control-Allow-Origin', origin);
  //   }
  // } else {
  //   const origin = req.headers.origin;
  //   if (crossOriginDomainsTest.indexOf(origin) > -1) {
  //     res.append('Access-Control-Allow-Origin', origin);
  //   }
  // }

  // Access-Control-Allow-Credentials
  res.append('Access-Control-Allow-Credentials', 'true');
  // allow rest http verbs
  res.append('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,PATCH,OPTIONS');
  // allow content type header
  res.append('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Authorization, X-Requested-With');
  next();
};

var io;

const roomTypes = {
  users: 'users',
  control: 'control',
}

// @todo: get this from a store of sorts (db, flat file whatever)
const instancesConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'dummy/instances.json'), 'utf-8'));

console.log('Configured instances', instancesConfig.length);

const instances = instancesConfig.map(instanceConfig => {
  let userSlots = [];

  for (let i = 0; i < instanceConfig.settings.slots; i++) {
    userSlots.push({
      slot_index: i + 1,
      client: {},
    });
  }

  return {
    ...instanceConfig,
    rooms: {
      users: `${roomTypes.users}:${instanceConfig.id}`,
      control: `${roomTypes.control}:${instanceConfig.id}`,
    },
    userSlots: userSlots,
    lastTriedSlotIndex: 0,
  }
});

// let userSlots = [];
// let lastTriedSlotIndex = 0;

async function main() {
  await setupHttpsServer();
  setupSocketServer();
}

main();


async function setupHttpsServer() {
  app.use(cors({
    origin: '*'
  }));
  // app.use(helmet());
  app.use(headerConfig);
  // app.use(bodyParser.urlencoded({ extended: true }));
  // app.use(bodyParser.json());
  // app.use(require('sanitize').middleware);

  //@todo: api mock - static config file
  app.use('/api', express.static(path.join(__dirname, 'dummy')));

  const serverHttps = http.createServer(app)
                          .listen(port, (e) => {
                            console.log('listening on ' + port);
                          });

  io = require('socket.io')({
    cors: true
  }).listen(serverHttps);
}

function random(mn, mx) {
  return Math.random() * (mx - mn) + mn;
}

const getRandomArrayElement = (arr) => {
  return arr[Math.floor(random(1, arr.length))-1];
}

const assignClientSlot = (instance, roomState, newClient, requestedSlotIndex) => {
  // override requested slot and assign new client id to it
  if (requestedSlotIndex) {
    instance.userSlots = instance.userSlots.map(slot => {
      if (slot.slot_index !== requestedSlotIndex) {
        return slot;
      }

      if (slot.client.id) {
        console.log('slot is occupied, disconnecting current tenant', slot.client.id);
        slot.client.disconnect();
      }

      return {
        ...slot,
        client: newClient,
      }
    });

    return requestedSlotIndex;
  }

  if (roomState.usedSlots + 1 > roomState.maxSlots) {
    console.log('no available slot for new client', newClient.id);
    return false;
  }

  // get free slots
  const freeSlots = instance.userSlots.filter(slot => !slot.client.id);
  const freeSlotsExcludingLastTried = freeSlots.length > 1 ? freeSlots.filter(slot => slot.slot_index !== instance.lastTriedSlotIndex) : freeSlots;

  console.log({freeSlotsExcludingLastTried})

  // pick random free slot
  const nextFreeSlotIndex = instance.settings.randomPick ? getRandomArrayElement(freeSlotsExcludingLastTried).slot_index : freeSlotsExcludingLastTried[0].slot_index;

  console.log({ nextFreeSlotIndex })

  // assign client id to it
  instance.userSlots = instance.userSlots.map(slot => {
    if (slot.slot_index !== nextFreeSlotIndex) {
      return slot;
    }

    return {
      ...slot,
      client: newClient,
    }
  });

  return nextFreeSlotIndex;
}

const resetClientSlot = (instance, client) => {
  console.log(instance)
  instance.userSlots = instance.userSlots.map(slot => {
    if (slot.client.id !== client.id) {
      return slot;
    }

    return {
      ...slot,
      client: {},
    }
  });
}

const createRoomState = (instance, clientsInRoom) => {
  const numClients = clientsInRoom ? clientsInRoom.size : 0;

  return {
    usedSlots: numClients,
    maxSlots: instance.settings.slots,
  };
}

function setupSocketServer() {
  console.log('setting up socket server');

  io.on('connection', (client) => {
    let assignedClientSlotIndex = false;

    // socket osc join request
    client.on('OSC_JOIN_REQUEST', (room) => {
      const instance = instances.filter(item => item.rooms.control === room)[0];

      if (!instance) {
        console.error('Invalid Room requested', room);
        return false;
      }

      console.log(`OSC_JOIN_REQUEST`, '| Instance:', instance.id, client.id, room);

      client.join(instance.rooms.control);

      const newRoomState = createRoomState(instance, io.sockets.adapter.rooms.get(instance.rooms.control));

      io.sockets.to(client.id).emit('OSC_JOIN_ACCEPTED', {
        id: client.id,
        ...newRoomState
      });

      io.sockets.to(roomTypes.control).emit(
        'OSC_JOINED',
        newRoomState
      );
    });

    // user join request
    client.on('USER_JOIN_REQUEST', ({ room, wantsSlot }) => {
      const instance = instances.filter(item => item.rooms.users === room)[0];

      if (!instance) {
        console.error('Invalid Room', room);
        return false;
      }

      console.log(`USER_JOIN_REQUEST`, '| Instance:', instance.id, client.id, room, wantsSlot);

      let requestedSlotIndex = false;
      if (wantsSlot && wantsSlot > 0 && wantsSlot <= instance.settings.slots) {
        requestedSlotIndex = wantsSlot;
        console.log('=> requested slot, will overtake', requestedSlotIndex);
      }

      const roomState = createRoomState(instance, io.sockets.adapter.rooms.get(instance.rooms.users));
      assignedClientSlotIndex = assignClientSlot(instance, roomState, client, requestedSlotIndex);
      instance.lastTriedSlotIndex = assignedClientSlotIndex;

      if (assignedClientSlotIndex === false) {
        io.sockets.to(client.id).emit(
          'USER_JOIN_REJECTED',
          {
            reason: `Room is currently full ${roomState.usedSlots}/${roomState.maxSlots}`,
          }
        );

        return;
      }

      client.join(instance.rooms.users);
      client.instanceId = instance.id;

      io.sockets.to(client.id).emit('USER_JOIN_ACCEPTED', {
        id: client.id,
        userSlot: assignedClientSlotIndex,
      });

      const newRoomState = createRoomState(instance, io.sockets.adapter.rooms.get(instance.rooms.users));
      console.log('OSC_CTRL_USER_JOINED', '| Instance:', instance.id,  client.id);
      io.sockets.to(instance.rooms.control).emit(
        'OSC_CTRL_USER_JOINED',
        {
          id: client.id,
          client_index: assignedClientSlotIndex,
          usedSlots: newRoomState.usedSlots,
          maxSlots: instance.settings.slots,
        }
      );

      io.sockets.to(instance.rooms.users).emit(
        'USER_JOINED',
        { ...newRoomState, client_index: assignedClientSlotIndex }
      );
    });

    client.on('disconnect', () => {
      const instance = instances.filter(item => item.id === client.instanceId)[0];

      if (!instance) {
        console.error('disconnect::Invalid Instance');
        return false;
      }

      const newRoomState = createRoomState(instance, io.sockets.adapter.rooms.get(instance.rooms.users));

      io.sockets.to(instance.rooms.control).emit(
        'OSC_CTRL_USER_LEFT',
        {
          id: client.id,
          client_index: assignedClientSlotIndex,
          usedSlots: newRoomState.usedSlots,
          maxSlots: newRoomState.maxSlots,
        }
      );

      io.sockets.to(instance.rooms.users).emit(
        'USER_LEFT',
        { ...newRoomState, client_index: assignedClientSlotIndex }
      );

      resetClientSlot(instance, client);
      console.log( 'User ' + client.id + '(' + assignedClientSlotIndex + ') disconnected');
    });

    client.on('OSC_HOST_MESSAGE', ({ data, room }) => {
      const processing_start = new Date().getTime();
      const instance = instances.filter(item => item.rooms.control === room)[0];

      if (!instance) {
        console.error('OSC_HOST_MESSAGE::Invalid Instance');
        return false;
      }

      console.log('OSC_HOST_MESSAGE', '| Instance:', instance.id, '|', data)

      io.sockets.to(instance.rooms.users).emit(
        'OSC_HOST_MESSAGE',
        {
          ...data,
          processed: new Date().getTime() - processing_start,
        }
      );
    })

    client.on('OSC_CTRL_MESSAGE', (data) => {
      const processing_start = new Date().getTime();
      const instance = instances.filter(item => item.id === client.instanceId)[0];

      if (!instance) {
        console.error('OSC_CTRL_MESSAGE::Invalid Instance');
        return false;
      }

      console.log('OSC_CTRL_MESSAGE', '| Instance:', instance.id, '| Slot:', assignedClientSlotIndex, '|', data)
      // @todo: make this dependant on current config
        // @todo: if we want to show users what others are doing in real time we'll need to broad cast to them too
      io.sockets.to(instance.rooms.control).emit(
        'OSC_CTRL_MESSAGE',
        {
          ...data,
          client_index: assignedClientSlotIndex,
          processed: new Date().getTime() - processing_start,
        }
      );
    });

    client.on('connect_failed', (err) => {
      console.log('connect failed!', err);
    });

    client.on('error', (err) => {
      console.log('there was an error on the connection!', err);
    });
  });
}