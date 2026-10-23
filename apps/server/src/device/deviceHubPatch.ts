/** Runtime npm installs bypass workspace patches. Apply this before publishing either host's hub. */
export const deviceHubScrcpyPatch = {
  file: "vendor/serve-emu/dist/scrcpy.js",
  before: '            "control=true",\n            `send_dummy_byte=${video}`,',
  after:
    '            "control=true",\n' +
    "            // Connecting a preview must preserve the device power state.\n" +
    '            "power_on=false",\n            `send_dummy_byte=${video}`,',
};
