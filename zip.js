const encoder = new TextEncoder();
const utf8 = 0x0800;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

// The diagnostic bundle has a few small entries. ZIP method 0 stores them as-is.
export function createZip(files, timestamp) {
  const date = new Date(timestamp);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >>> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const local = [];
  const central = [];
  let offset = 0;
  let centralSize = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, utf8, true);
    header.setUint16(10, dosTime, true);
    header.setUint16(12, dosDate, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.byteLength, true);
    header.setUint32(22, data.byteLength, true);
    header.setUint16(26, name.byteLength, true);
    local.push(header.buffer, name, data);

    const directory = new DataView(new ArrayBuffer(46));
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 20, true);
    directory.setUint16(6, 20, true);
    directory.setUint16(8, utf8, true);
    directory.setUint16(12, dosTime, true);
    directory.setUint16(14, dosDate, true);
    directory.setUint32(16, crc, true);
    directory.setUint32(20, data.byteLength, true);
    directory.setUint32(24, data.byteLength, true);
    directory.setUint16(28, name.byteLength, true);
    directory.setUint32(42, offset, true);
    central.push(directory.buffer, name);
    centralSize += directory.byteLength + name.byteLength;
    offset += header.byteLength + name.byteLength + data.byteLength;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...local, ...central, end.buffer], { type: "application/zip" });
}
