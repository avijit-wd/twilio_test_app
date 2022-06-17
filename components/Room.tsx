import React, { useEffect, useState } from "react";
import { Room as VideoRoom } from "twilio-video";
import { BreakoutRoom } from "../pages/index";
import Participant from "./Participant";

interface RoomProps {
  room: VideoRoom;
  breakoutRoomList: BreakoutRoom[];
  parentSid: string;
  joinRoom: (roomSid: string, breakout: boolean) => void;
  leaveRoom: () => void;
}

const Room = ({
  room,
  breakoutRoomList,
  parentSid,
  joinRoom,
  leaveRoom,
}: RoomProps) => {
  const [remoteParticipants, setRemoteParticipants] = useState(
    Array.from(room.participants.values())
  );

  // Whenever the room changes, set up listeners
  useEffect(() => {
    room.on("participantConnected", (participant) => {
      console.log(`${participant.identity} has entered the chat`);
      setRemoteParticipants((prevState) => [...prevState, participant]);
    });
    room.on("participantDisconnected", (participant) => {
      console.log(`${participant.identity} has left the chat`);
      setRemoteParticipants((prevState) =>
        prevState.filter((p) => p.identity !== participant.identity)
      );
    });
  }, [room]);

  const changeRoom = async (sid: string, returnToMain: boolean = false) => {
    // Disconnect fully from the room you're in currently before joining the next one
    await leaveRoom();

    if (returnToMain) {
      return joinRoom(parentSid, false);
    }
    return joinRoom(sid, true);
  };

  return (
    <div className="room">
      <h2 className="roomName">{room.name}</h2>
      <div className="participants">
        <Participant
          key={room.localParticipant.identity}
          participant={room.localParticipant}
        />
        {remoteParticipants.map((participant) => (
          <Participant key={participant.identity} participant={participant} />
        ))}
      </div>
      <div className="breakouts-list">
        {breakoutRoomList.length > 0 && <h3>Breakout Rooms</h3>}

        {breakoutRoomList.map((room) => {
          return (
            <button
              className="breakout"
              key={room._id}
              onClick={() => changeRoom(room._id, false)}
            >
              {room.name}
            </button>
          );
        })}
      </div>
      {room.sid !== parentSid && (
        <button onClick={() => changeRoom(parentSid, true)}>
          Return to Main Room
        </button>
      )}
      <button onClick={leaveRoom}>Leave Video Call</button>
    </div>
  );
};

export default Room;
