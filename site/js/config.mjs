// Public integration settings, preserved from the existing frontend. No secrets.
export const CONFIG = {
        submissionEndpoint: "https://root-archive-worker.omar-khldooon33.workers.dev",
        googleClientId: "451085424306-tll56iseq0qd9lcofeb1nkiqiaq0opvh.apps.googleusercontent.com",
        turnstileSiteKey: "0x4AAAAAAFtYsxdbI-Zx8mjy",
        allowedStudentDomain: "std.aum.edu.jo",
        maxFileSize: 24 * 1024 * 1024 // 24 MiB safe file limit under the Worker's 25 MiB multipart body limit
      };

export const FILE_POLICIES = {
        ".pdf": {
          allowedMimes: new Set(["application/pdf"]),
          signature: [0x25, 0x50, 0x44, 0x46, 0x2d]
        },
        ".docx": {
          allowedMimes: new Set([
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          ]),
          signature: [0x50, 0x4b, 0x03, 0x04]
        },
        ".zip": {
          allowedMimes: new Set([
            "application/zip",
            "application/x-zip-compressed",
            "multipart/x-zip"
          ]),
          signature: [0x50, 0x4b, 0x03, 0x04]
        },
        ".png": {
          allowedMimes: new Set(["image/png"]),
          signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        },
        ".jpg": {
          allowedMimes: new Set(["image/jpeg", "image/pjpeg"]),
          signature: [0xff, 0xd8, 0xff]
        }
      };

export const TRACKS = ['CS', 'AI', 'Cybersecurity'];
export const TYPES = ['Past Paper', 'Summary', 'Test Bank', 'Other'];
export const TRACK_LABELS = { CS: 'Computer Science', AI: 'Artificial Intelligence', Cybersecurity: 'Cybersecurity' };
