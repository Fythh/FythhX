const path = require('path');
const config = { paths: {
    downloads: 'C:/dl',
    trim: 'C:/dl/trim',
    clips: 'C:/dl/clips',
    dead_air: 'C:/dl/dead_air'
}};
const fileUrl = '/downloads/trim/my%20file.mp4';
const folders = [
      { path: config.paths.downloads, prefix: '/downloads/' },
      { path: config.paths.trim, prefix: '/downloads/trim/' },
      { path: config.paths.clips, prefix: '/downloads/clips/' },
      { path: config.paths.dead_air, prefix: '/downloads/dead_air/' }
];
const sortedFolders = folders.sort((a, b) => b.prefix.length - a.prefix.length);
console.log(sortedFolders.map(f => f.prefix));
for (const folder of sortedFolders) {
    if (fileUrl.startsWith(folder.prefix)) {
        const filename = decodeURIComponent(fileUrl.substring(folder.prefix.length));
        console.log({ prefix: folder.prefix, filename });
        const targetPath = path.join(folder.path, filename);
        console.log({ targetPath });
        
        // Directory traversal check
        const normalizedTarget = path.normalize(targetPath);
        const normalizedFolder = path.normalize(folder.path);
        console.log(normalizedTarget.startsWith(normalizedFolder));
        break;
    }
}
