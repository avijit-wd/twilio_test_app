import React, { useEffect, useState } from "react";
import { connect, Room as VideoRoom } from "twilio-video";
import io, { Socket } from "socket.io-client";
import Room from "../components/Room";

export interface MainRoom {
  _id: string;
  name: string;
  breakouts: BreakoutRoom[];
}

export interface BreakoutRoom {
  _id: string;
  name: string;
}

const Home = () => {
  // State variables
  const [identity, setIdentity] = useState("");
  const [room, setRoom] = useState<VideoRoom>();
  const [roomList, setRoomList] = useState<MainRoom[]>([]);
  const [showControls, setShowControls] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [parentSid, setParentSid] = useState("");
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SOCKET_URL) {
      const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL, {
        transports: ["websocket"],
      });

      // Listen for events
      socket.on("Main room created", () => listRooms());
      socket.on("Breakout room created", () => listRooms());

      setSocket(socket);
    }

    listRooms();

    // Clean up the listeners when the component is about to unmount.
    return () => {
      if (socket) {
        socket.off("Main room created");
        socket.off("Breakout room created");
      }
    };
  }, []);

  // Show or hide the controls when a user checks the checkbox.
  const onCheckboxChange = () => {
    setShowControls(!showControls);
  };

  // List all of the available main rooms
  const listRooms = async () => {
    try {
      const response = await fetch("http://localhost:5000/rooms/", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();
      setRoomList(data.rooms);
    } catch (err) {
      console.log(err);
    }
  };

  // Create a new main room
  const createRoom = async () => {
    try {
      const response = await fetch("http://localhost:5000/rooms/main", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomName: newRoomName,
        }),
      });

      await response.json();

      // Once the new room is created, set this input field to be blank
      setNewRoomName("");
    } catch (err) {
      console.log(err);
    }
  };

  // Create a new breakout room
  const createBreakoutRoom = async () => {
    // For now, disallow creating nested breakout rooms.
    // If the current room isn't a main room, don't let a new breakout be created.
    if (!roomList.find((mainRoom) => room?.sid === mainRoom._id)) {
      console.log("Creating nested breakout rooms is not yet implemented.");
      return;
    }

    try {
      const response = await fetch("http://localhost:5000/rooms/breakout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomName: newRoomName, parentSid: room?.sid }),
      });

      await response.json();
      setNewRoomName("");
    } catch (err) {
      console.log(err);
    }
  };

  // Join a video room
  const joinRoom = async (roomSid: string, breakout: boolean = false) => {
    try {
      // If you're already in another video room, disconnect from that room first
      if (room) {
        await room.disconnect();
      }

      // Fetch an access token from the server
      const response = await fetch("http://localhost:5000/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identity,
          roomSid,
        }),
      });

      const data = await response.json();

      // Connect to the video room
      const videoRoom = await connect(data.accessToken, {
        audio: true,
        video: { width: 640, height: 480 },
      });

      // Save this video room in the state
      setRoom(videoRoom);
      if (!breakout) setParentSid(videoRoom.sid);
    } catch (err) {
      console.log(err);
    }
  };

  // Leave a video room
  const leaveRoom = async () => {
    if (room) {
      // Detach and remove all the tracks
      room.localParticipant.tracks.forEach((publication) => {
        if (
          publication.track.kind === "audio" ||
          publication.track.kind === "video"
        ) {
          publication.track.stop();
          const attachedElements = publication.track.detach();
          attachedElements.forEach((element) => element.remove());
        }
      });

      room.disconnect();
      setRoom(undefined);
    }
  };

  const getBreakoutRooms = () => {
    // Select the current room from the roomList and return its breakout rooms.
    if (room) {
      const roomInfo = roomList.find((mainRoom) => mainRoom._id === room.sid);
      if (roomInfo) {
        return roomInfo.breakouts;
      }
    }

    // If there are no breakout rooms, return an empty array.
    return [];
  };

  return (
    <div className="app">
      <label className="start">
        <input
          type="checkbox"
          checked={showControls}
          onChange={onCheckboxChange}
        />
        Show Room Controls
      </label>

      {showControls && (
        <div className="controls">
          <label className="start">
            Name your room:
            <input
              value={newRoomName}
              onChange={(event) => {
                setNewRoomName(event.target.value);
              }}
            />
          </label>
          <button
            disabled={newRoomName === "" ? true : false}
            onClick={room ? createBreakoutRoom : createRoom}
          >
            {room ? "Create Breakout Room" : "Create Room"}
          </button>
        </div>
      )}
      {room === undefined ? (
        <div className="start">
          <input
            value={identity}
            onChange={(event) => {
              setIdentity(event.target.value);
            }}
            placeholder="Enter your name"
          />
        </div>
      ) : (
        <Room
          room={room}
          joinRoom={joinRoom}
          leaveRoom={leaveRoom}
          breakoutRoomList={getBreakoutRooms()}
          parentSid={parentSid}
        />
      )}

      <div className="video-rooms-list">
        {room == null && roomList.length > 0 && (
          <h3>Video Rooms - Click a button to join</h3>
        )}
        {room == null &&
          roomList.map((room) => {
            return (
              <button
                disabled={identity === "" ? true : false}
                key={room._id}
                onClick={() => joinRoom(room._id)}
              >
                {room.name}
              </button>
            );
          })}
      </div>
    </div>
  );
};

export default Home;
