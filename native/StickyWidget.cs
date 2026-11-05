using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DshStickyNotes
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                int parentPid = 0;
                string dataDir = null;
                for (int index = 0; index < args.Length; index++)
                {
                    if (args[index] == "--parent-pid" && index + 1 < args.Length)
                    {
                        int.TryParse(args[index + 1], out parentPid);
                    }
                    if (args[index] == "--data-dir" && index + 1 < args.Length)
                    {
                        dataDir = args[index + 1];
                    }
                }
                DataRoot = dataDir;
                Application.Run(new StickyForm(parentPid));
            }
            catch (Exception error)
            {
                Log("fatal: " + error);
                MessageBox.Show(error.Message, "DSH Sticky Notes", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        internal static string DataRoot;

        internal static string StateDirectory
        {
            get
            {
                string path = DataRoot;
                if (String.IsNullOrWhiteSpace(path))
                {
                    path = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "dsh-sticky-notes-wall");
                }
                Directory.CreateDirectory(path);
                return path;
            }
        }

        internal static void Log(string message)
        {
            try
            {
                string path = Path.Combine(StateDirectory, "native.log");
                File.AppendAllText(path, DateTime.Now.ToString("s") + " " + message + Environment.NewLine, Encoding.UTF8);
            }
            catch
            {
            }
        }
    }

    /// <summary>
    /// A borderless, always-on-top note window. The visual part is the local
    /// widget folder rendered by WebView2; this form only owns the frame,
    /// placement, tray icon and the small message protocol.
    /// </summary>
    internal sealed class StickyForm : Form
    {
        private const int WM_NCLBUTTONDOWN = 0xA1;
        private const int HTCAPTION = 0x2;
        private const string VirtualHost = "dsh-sticky.local";

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        private readonly int parentPid;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly string boundsPath;
        private readonly string userDataFolder;
        private readonly string widgetFolder;
        private readonly Timer saveTimer;
        private readonly Timer parentTimer;
        private WebView2 web;
        private NotifyIcon tray;
        private bool readyPosted;
        private bool closingForReal;

        public StickyForm(int parentPid)
        {
            this.parentPid = parentPid;
            boundsPath = Path.Combine(Program.StateDirectory, "window.json");
            userDataFolder = Path.Combine(Program.StateDirectory, "webview2");
            widgetFolder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "widget");

            Text = "DSH Sticky Notes";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.FromArgb(24, 24, 28);
            DoubleBuffered = true;
            MinimumSize = new Size(260, 240);
            AutoScaleMode = AutoScaleMode.Dpi;
            TopMost = true;

            LoadWindowState();
            BuildWebView();
            BuildTray();

            saveTimer = new Timer();
            saveTimer.Interval = 500;
            saveTimer.Tick += delegate { saveTimer.Stop(); SaveWindowState(); };
            Move += delegate { QueueSave(); };
            Resize += delegate { QueueSave(); UpdateRegion(); };

            parentTimer = new Timer();
            parentTimer.Interval = 2000;
            parentTimer.Tick += delegate { CheckParent(); };
            if (parentPid > 0) parentTimer.Start();

            UpdateRegion();
        }

        private void BuildWebView()
        {
            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Color.FromArgb(0, 0, 0, 0);
            web.AllowExternalDrop = false;
            Controls.Add(web);
            Load += async delegate
            {
                try
                {
                    Directory.CreateDirectory(userDataFolder);
                    CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, userDataFolder, null);
                    await web.EnsureCoreWebView2Async(environment);
                    CoreWebView2 core = web.CoreWebView2;
                    core.Settings.AreDefaultContextMenusEnabled = false;
                    core.Settings.AreDevToolsEnabled = false;
                    core.Settings.IsStatusBarEnabled = false;
                    core.Settings.IsPasswordAutosaveEnabled = false;
                    core.Settings.IsGeneralAutofillEnabled = false;
                    core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                    core.Settings.IsZoomControlEnabled = false;
                    core.WebMessageReceived += OnWebMessage;
                    core.NavigationCompleted += delegate { if (!readyPosted) PostInit(); };
                    core.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs args)
                    {
                        Program.Log("webview process failed: " + args.ProcessFailedKind);
                    };
                    core.SetVirtualHostNameToFolderMapping(VirtualHost, widgetFolder, CoreWebView2HostResourceAccessKind.Allow);
                    core.Navigate("https://" + VirtualHost + "/index.html?v=1");
                }
                catch (Exception error)
                {
                    Program.Log("webview init failed: " + error);
                    MessageBox.Show(
                        "无法启动便签桌面窗口。请确认系统已安装 Microsoft Edge WebView2 Runtime。\n\n" + error.Message,
                        "DSH Sticky Notes",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                    CloseForReal();
                }
            };
        }

        private void BuildTray()
        {
            Icon icon = null;
            try
            {
                icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
            }
            if (icon == null) icon = SystemIcons.Application;
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("显示便签 / Show notes", null, delegate { ShowWidget(); });
            menu.Items.Add("重新加载 / Reload", null, delegate { if (web != null) web.Reload(); });
            menu.Items.Add("退出 / Quit", null, delegate { CloseForReal(); });
            tray = new NotifyIcon();
            tray.Icon = icon;
            tray.Text = "DSH Sticky Notes";
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
            tray.DoubleClick += delegate { ShowWidget(); };
        }

        private void ShowWidget()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        private void QueueSave()
        {
            if (saveTimer == null || closingForReal) return;
            saveTimer.Stop();
            saveTimer.Start();
        }

        private void LoadWindowState()
        {
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            int width = 360;
            int height = 520;
            int x = area.Right - width - 24;
            int y = area.Top + 80;
            try
            {
                if (File.Exists(boundsPath))
                {
                    Dictionary<string, object> data = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(boundsPath, Encoding.UTF8));
                    if (data != null)
                    {
                        if (data.ContainsKey("width")) width = Convert.ToInt32(data["width"]);
                        if (data.ContainsKey("height")) height = Convert.ToInt32(data["height"]);
                        if (data.ContainsKey("x")) x = Convert.ToInt32(data["x"]);
                        if (data.ContainsKey("y")) y = Convert.ToInt32(data["y"]);
                    }
                }
            }
            catch (Exception error)
            {
                Program.Log("load window state failed: " + error.Message);
            }
            width = Math.Max(260, Math.Min(width, area.Width - 16));
            height = Math.Max(240, Math.Min(height, area.Height - 16));
            x = Math.Max(area.Left + 8, Math.Min(x, area.Right - width - 8));
            y = Math.Max(area.Top + 8, Math.Min(y, area.Bottom - height - 8));
            Bounds = new Rectangle(x, y, width, height);
        }

        private void SaveWindowState()
        {
            try
            {
                Dictionary<string, object> data = new Dictionary<string, object>();
                data["x"] = Left;
                data["y"] = Top;
                data["width"] = Width;
                data["height"] = Height;
                File.WriteAllText(boundsPath, json.Serialize(data), Encoding.UTF8);
            }
            catch (Exception error)
            {
                Program.Log("save window state failed: " + error.Message);
            }
        }

        private void UpdateRegion()
        {
            if (Width <= 0 || Height <= 0) return;
            int radius = 18;
            using (GraphicsPath path = new GraphicsPath())
            {
                path.AddArc(0, 0, radius, radius, 180, 90);
                path.AddArc(Width - radius, 0, radius, radius, 270, 90);
                path.AddArc(Width - radius, Height - radius, radius, radius, 0, 90);
                path.AddArc(0, Height - radius, radius, radius, 90, 90);
                path.CloseFigure();
                Region old = Region;
                Region = new Region(path);
                if (old != null) old.Dispose();
            }
        }

        private void ApplySize(int width, int height)
        {
            Rectangle area = Screen.FromRectangle(Bounds).WorkingArea;
            width = Math.Max(260, Math.Min(width, area.Width - 16));
            height = Math.Max(240, Math.Min(height, area.Height - 16));
            int right = Right;
            int bottom = Bottom;
            Size = new Size(width, height);
            if (right > area.Right - 8) Left = area.Right - width - 8;
            if (bottom > area.Bottom - 8) Top = area.Bottom - height - 8;
            QueueSave();
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            try
            {
                string body = args.TryGetWebMessageAsString();
                if (String.IsNullOrWhiteSpace(body)) return;
                Dictionary<string, object> message = json.Deserialize<Dictionary<string, object>>(body);
                if (message == null || !message.ContainsKey("type")) return;
                string type = Convert.ToString(message["type"]);
                if (type == "drag")
                {
                    ReleaseCapture();
                    SendMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);
                }
                else if (type == "close")
                {
                    Hide();
                }
                else if (type == "quit")
                {
                    CloseForReal();
                }
                else if (type == "resize")
                {
                    int width = message.ContainsKey("width") ? Convert.ToInt32(message["width"]) : Width;
                    int height = message.ContainsKey("height") ? Convert.ToInt32(message["height"]) : Height;
                    ApplySize(width, height);
                }
                else if (type == "focus-host")
                {
                    FocusHost();
                }
                else if (type == "reload")
                {
                    if (web != null) web.Reload();
                }
                else if (type == "ready")
                {
                    if (!readyPosted) PostInit();
                }
            }
            catch (Exception error)
            {
                Program.Log("web message failed: " + error);
            }
        }

        private void FocusHost()
        {
            if (parentPid <= 0) return;
            try
            {
                Process host = Process.GetProcessById(parentPid);
                IntPtr handle = host.MainWindowHandle;
                if (handle != IntPtr.Zero)
                {
                    ShowWindow(handle, 9);
                    SetForegroundWindow(handle);
                }
            }
            catch (Exception error)
            {
                Program.Log("focus host failed: " + error.Message);
            }
        }

        private void PostInit()
        {
            try
            {
                if (web == null || web.CoreWebView2 == null) return;
                Dictionary<string, object> data = new Dictionary<string, object>();
                data["type"] = "ready";
                data["platform"] = "windows";
                web.CoreWebView2.PostWebMessageAsJson(json.Serialize(data));
                readyPosted = true;
            }
            catch (Exception error)
            {
                Program.Log("post init failed: " + error.Message);
            }
        }

        private void CheckParent()
        {
            if (parentPid <= 0) return;
            try
            {
                Process.GetProcessById(parentPid);
            }
            catch (Exception error)
            {
                Program.Log("parent process " + parentPid + " is unavailable: " + error.Message);
                CloseForReal();
            }
        }

        private void CloseForReal()
        {
            closingForReal = true;
            try
            {
                if (saveTimer != null) saveTimer.Stop();
                SaveWindowState();
                if (tray != null)
                {
                    tray.Visible = false;
                    tray.Dispose();
                }
                if (!IsDisposed) Close();
            }
            catch
            {
                Application.Exit();
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!closingForReal)
            {
                closingForReal = true;
                try
                {
                    if (saveTimer != null) saveTimer.Stop();
                    SaveWindowState();
                    if (tray != null)
                    {
                        tray.Visible = false;
                        tray.Dispose();
                    }
                }
                catch
                {
                }
            }
            base.OnFormClosing(e);
        }
    }
}