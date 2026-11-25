# FlowGPT Connection Diagnostics

[Installation and usage guide](docs/GUIDE.md) · [Privacy policy](docs/PRIVACY.md)

This Chrome extension helps FlowGPT and Emochi users record connection failures and share a diagnostic report with support. To try it from source, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the folder containing `manifest.json`.

1. Open the affected FlowGPT or Emochi page and choose **Start recording** in the extension.
2. Repeat the action that failed in that tab without changing networks. The page panel shows the countdown and the number of failed requests. You can hide it and keep recording.
3. Open the extension again. Check the selected request. With the error still visible, choose **Download ZIP** to save the complete diagnostic bundle. You can also copy the report or save an image. Send the result privately to support.

Each tab has its own recording. To test FlowGPT and Emochi at the same time, start recording in each tab. Stop, clear or download the report from the tab where you ran that test.

The extension observes failed requests in the chosen tab for up to five minutes. It reads the Cloudflare Ray ID and challenge response headers and keeps the status, method and time. Report URLs omit credentials, queries and fragments. Save your report before closing the tested tab or Chrome. No data is uploaded or submitted to support automatically.

For a page-level Cloudflare error, the extension looks for the public IP in the page footer and checks that the Ray ID matches. Otherwise, it checks /cdn-cgi/trace on the selected request's host and labels the IP as a later measurement. That value can differ if network routing has changed. Some failed requests have no Ray ID when the browser receives no Cloudflare response.

The ZIP contains the selected report as text, all failures recorded so far in CSV and JSON, and one screenshot of the current page. Stop recording first if you want the bundle to cover the full test. Saving a standalone image combines the visible webpage and report in one PNG. Review the screenshot for private content before sharing.

Use **Filter requests** to narrow by request area or failure type. The ZIP still includes every recorded failure with both labels and the evidence behind the classification. A 403 with only a Ray ID is marked source unverified. Cloudflare-generated errors are identified from their diagnostic headers or a recognized block page with a matching Ray ID.

The Chrome Web Store is the distribution path for regular users.
