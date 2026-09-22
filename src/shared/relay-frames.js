function encodeFrame(header, body = Buffer.alloc(0)) {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32BE(json.length, 0);
  prefix.writeUInt32BE(body.length, 4);
  return Buffer.concat([prefix, json, body]);
}

function attachFrameReader(socket, onMessage) {
  let buf = Buffer.alloc(0);
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const headerLength = buf.readUInt32BE(0);
      const bodyLength = buf.readUInt32BE(4);
      if (headerLength > 1024 * 1024 || bodyLength > 8 * 1024 * 1024) {
        socket.destroy();
        return;
      }
      const total = 8 + headerLength + bodyLength;
      if (buf.length < total) {
        break;
      }
      let header;
      try {
        header = JSON.parse(buf.subarray(8, 8 + headerLength).toString('utf8'));
      } catch {
        socket.destroy();
        return;
      }
      const body = buf.subarray(8 + headerLength, total);
      buf = buf.subarray(total);
      onMessage(header, body);
    }
  };
  socket.on('data', onData);
  return () => socket.off('data', onData);
}

module.exports = {
  encodeFrame,
  attachFrameReader,
};
