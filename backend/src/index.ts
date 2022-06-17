import * as dotenv from "dotenv";
import express, { Request, Response } from "express";
import cors from "cors";
import twilio, { Twilio } from "twilio";
import PouchDB from "pouchdb";
import { Server } from "socket.io";

dotenv.config();

const port = process.env.PORT || 5000;
const allowedOrigins = ["http://localhost:3000"];

const app = express();
app.use(express.json());

const options: cors.CorsOptions = {
  origin: allowedOrigins,
};

app.use(cors(options));

export interface VideoRoom {
  _id: string;
  _rev: string;
  breakouts: string[];
}

interface MainRoomItem {
  _id: string;
  name: string;
  breakouts: BreakoutRoomItem[];
}

interface BreakoutRoomItem {
  _id: string;
  name: string;
}

const db = new PouchDB<VideoRoom>("video_rooms");

const twilioClient = new Twilio(
  process.env.TWILIO_API_KEY as string,
  process.env.TWILIO_API_SECRET as string,
  { accountSid: process.env.TWILIO_ACCOUNT_SID as string }
);

/**
 * Create a new main room
 */
const createRoom = async (request: Request, response: Response) => {
  // Get the room name from the request body.
  // If no room name is provided, the name will be set to the room's SID.
  const roomName: string = request.body.roomName || "";

  try {
    // Call the Twilio video API to create the new room.
    const room = await twilioClient.video.rooms.create({
      uniqueName: roomName,
      type: "group",
    });

    const mainRoom: VideoRoom = {
      _id: room.sid,
      _rev: "",
      breakouts: [],
    };

    try {
      // Save the document in the db.
      await db.put(mainRoom);

      response.status(200).send({
        message: `New video room ${room.uniqueName} created`,
        room: mainRoom,
      });

      io.emit("Main room created");
      return;
    } catch (error) {
      return response.status(400).send({
        message: `Error saving new room to db -- room name=${roomName}`,
        error,
      });
    }
  } catch (error) {
    // If something went wrong, handle the error.
    return response.status(400).send({
      message: `Unable to create new room with name=${roomName}`,
      error,
    });
  }
};

/**
 * Create a new breakout room
 */
const createBreakoutRoom = async (request: Request, response: Response) => {
  // Get the roomName and parentSid from the request body.
  const roomName: string = request.body.roomName || "";

  // If no parent was provided, return an error message.
  if (!request.body.parentSid) {
    return response.status(400).send({
      message: `No parentSid provided for new breakout room with name=${roomName}`,
    });
  }

  const parentSid: string = request.body.parentSid;

  try {
    // Call the Twilio video API to create the new room.
    const breakoutRoom = await twilioClient.video.rooms.create({
      uniqueName: roomName,
      type: "group",
    });

    try {
      // Save the new breakout room on its parent's record (main room).
      const mainRoom: VideoRoom = await db.get(parentSid);
      mainRoom.breakouts.push(breakoutRoom.sid);
      await db.put(mainRoom);

      // Return the full room details in the response.
      response.status(200).send({
        message: `Breakout room ${breakoutRoom.uniqueName} created`,
        room: mainRoom,
      });

      io.emit("Breakout room created");
      return;
    } catch (error) {
      return response.status(400).send({
        message: `Error saving new breakout room to db -- breakout room name=${roomName}`,
        error,
      });
    }
  } catch (error) {
    // If something went wrong, handle the error.
    return response.status(400).send({
      message: `Unable to create new breakout room with name=${roomName}`,
      error,
    });
  }
};

/**
 * List active video rooms
 */
const listActiveRooms = async (request: Request, response: Response) => {
  try {
    // Get the last 20 rooms that are still currently in progress.
    const rooms = await twilioClient.video.rooms.list({
      status: "in-progress",
      limit: 20,
    });

    // Get a list of active room sids.
    let activeRoomSids = rooms.map((room) => room.sid);

    try {
      // Retrieve the room documents from the database.
      let dbRooms = await db.allDocs({
        include_docs: true,
      });

      // Filter the documents to include only the main rooms that are active.
      let dbActiveRooms = dbRooms.rows.filter((mainRoomRecord) => {
        return activeRoomSids.includes(mainRoomRecord.id) && mainRoomRecord;
      });

      // Create a list of MainRoomItem that will associate a room's id with its name and breakout rooms.
      let videoRooms: MainRoomItem[] = [];

      // For each of the active rooms from the db, get the details for that main room and its breakout rooms.
      // Then pass that data into an array to return to the client side.
      if (dbActiveRooms) {
        dbActiveRooms.forEach((row) => {
          // Find the specific main room in the list of rooms returned from the Twilio Rooms API.
          const activeMainRoom = rooms.find((mainRoom) => {
            return mainRoom.sid === row.doc._id;
          });

          // Get the list of breakout rooms from this room's document.
          const breakoutSids = row.doc.breakouts;

          // Filter to select only the breakout rooms that are active according to
          // the response from the Twilio Rooms API.
          const activeBreakoutRooms = rooms.filter((breakoutRoom) => {
            return breakoutSids.includes(breakoutRoom.sid);
          });

          // Create a list of BreakoutRoomItems that will contain each breakout room's name and id.
          let breakouts: BreakoutRoomItem[] = [];

          // Get the names of each breakout room from the API response.
          activeBreakoutRooms.forEach((breakoutRoom) => {
            breakouts.push({
              _id: breakoutRoom.sid,
              name: breakoutRoom.uniqueName,
            });
          });

          const videoRoom: MainRoomItem = {
            _id: activeMainRoom.sid,
            name: activeMainRoom.uniqueName,
            breakouts: breakouts,
          };

          // Add this room to the list of rooms to return to the client side.
          videoRooms.push(videoRoom);
        });
      }

      // Return the list of active rooms to the client side.
      return response.status(200).send({
        rooms: videoRooms,
      });
    } catch (error) {
      return response.status(400).send({
        message: `Error retrieving video rooms from db`,
        error,
      });
    }
  } catch (error) {
    return response.status(400).send({
      message: `Unable to list active rooms`,
      error,
    });
  }
};

/**
 * Get a token for a user for a video room
 */
const getToken = (request: Request, response: Response) => {
  const AccessToken = twilio.jwt.AccessToken;
  const VideoGrant = AccessToken.VideoGrant;

  // Get the user's identity and roomSid from the query.
  const { identity, roomSid } = request.body;

  // Create the access token.
  const token = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID as string,
    process.env.TWILIO_API_KEY as string,
    process.env.TWILIO_API_SECRET as string,
    { identity: identity as string }
  );

  token.identity = identity;

  // Add a VideoGrant to the token to allow the user of this token to use Twilio Video
  const grant = new VideoGrant({ room: roomSid as string });
  token.addGrant(grant);

  response.json({
    accessToken: token.toJwt(),
  });
};

app.post("/rooms/main", createRoom);
app.post("/rooms/breakout", createBreakoutRoom);
app.get("/rooms/", listActiveRooms);
app.post("/token", getToken);

const server = app.listen(port, () => {
  console.log(`Express server running on port ${port}`);
});

const io = new Server(server);
