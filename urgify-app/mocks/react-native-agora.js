export const ChannelProfileType = {
  ChannelProfileLiveBroadcasting: 1,
  ChannelProfileCommunication: 0,
};

export const ClientRoleType = {
  ClientRoleBroadcaster: 1,
  ClientRoleAudience: 2,
};

export const createAgoraRtcEngine = () => {
  return {
    initialize: () => {},
    enableVideo: () => {},
    enableAudio: () => {},
    joinChannel: () => {},
    leaveChannel: () => {},
    release: () => {},
    addListener: () => ({ remove: () => {} }),
    setChannelProfile: () => {},
    setClientRole: () => {},
  };
};

export default createAgoraRtcEngine;
