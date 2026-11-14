# Private moderation portal

These files belong to the moderation Worker static asset binding, outside the
public Pages `site/` directory. Keep `assets.run_worker_first: true`: the Worker
verifies Access and its administrator allowlist before serving the HTML, scripts,
styles, fonts, catalog or any private API/file. Do not deploy this directory as
an unprotected Pages site. Configuration and rollout are covered in the main
moderation operations guide.

The portal uses `/admin/api/` on the same authenticated origin. It sends no
private file to a conversion, AI or other third-party service. Contributor data
and audit entries are rendered as text. Session failures and conflicting writes
retain the metadata draft; Access can be completed in a new tab before retrying.

Image preparation supports 90-degree rotation, pixel-coordinate cropping,
brightness, contrast, grayscale, scan-style thresholding and opaque black pixel
redactions. Redaction supports pointer dragging and keyboard coordinate fields.
The administrator previews and explicitly confirms the output before saving it
as a new private PNG candidate. Approval requires a second content review.
Canvas rendering creates a flattened output without the original image
metadata or hidden layers. Redaction is applied after all adjustments. Cropping
or rotation clears previous redactions with an explicit notice, so they must be
reapplied. PNG exports are bounded to 24 MiB, source images to 12 megapixels and
8000 pixels per edge. Local PNG export is also available.

Perspective correction, deskew, native PDF page editing and PDF redaction are
not implemented. PDFs and office/archive files are downloaded for local
inspection rather than embedded as active content. Use an appropriate external
PDF sanitization tool, verify that sensitive underlying text/images are removed,
then upload the replacement. Every supported file type supports replacement.
No rectangle drawn over a PDF is presented as secure redaction. The current
public version stays unchanged until a candidate is approved; unpublishing first
revokes public access while keeping files private for correction.

`tests/frontend/admin.test.mjs` exercises synthetic API responses and generated
image pixels in Chromium. It does not establish live Access, Cloudflare or Google
integration behavior.
