// Tiny Mendix package files (.mpk, a zip) for the Marketplace tests: a widget with a package.xml and its
// widget XML, a module with a modelerProject package.xml. Written with node:zlib (deflate) and zlib.crc32.
import { crc32, deflateRawSync } from 'node:zlib';

/** A zip of `files` (name → text), each entry deflated. */
export function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const comp = deflateRawSync(data);
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A widget package: clientModule `name` at `version`, one widget with id `id`. */
export function widgetMpk(name = 'FileUploader', version = '2.5.1', id = 'com.example.widget.web.fileuploader.FileUploader'): Buffer {
  return zip({
    'package.xml': `<?xml version="1.0" encoding="utf-8" ?>\n<package xmlns="http://www.mendix.com/package/1.0/">\n  <clientModule name="${name}" version="${version}" xmlns="http://www.mendix.com/clientModule/1.0/">\n    <widgetFiles><widgetFile path="${name}.xml" /></widgetFiles>\n    <files><file path="com/example/" /></files>\n  </clientModule>\n</package>\n`,
    [`${name}.xml`]: `<?xml version="1.0" encoding="utf-8" ?>\n<widget id="${id}" pluginWidget="true" xmlns="http://www.mendix.com/widget/1.0/"><name>File uploader</name></widget>\n`,
    'com/example/widget/web/fileuploader/FileUploader.js': 'export default 1;\n',
  });
}

/** A module package: module `name`. */
export function moduleMpk(name = 'SampleUtils'): Buffer {
  return zip({
    'package.xml': `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.mendix.com/package/1.0/">\n  <modelerProject xmlns="http://www.mendix.com/modelerProject/1.0/">\n    <module name="${name}" />\n    <projectFile path="project.mpr" />\n  </modelerProject>\n</package>\n`,
    'project.mpr': 'not really a model',
  });
}
