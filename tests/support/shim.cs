// The Windows shim for the tests' node scripts (see winshim.ts): <name>.exe runs `node <dir>\<name> <args…>`.
using System; using System.Diagnostics; using System.IO; using System.Text; using System.Runtime.InteropServices;
class Shim {
  // A job that kills node when the shim goes (the office killing a worker's terminal kills the shim):
  // without it, node outlives the shim and keeps the terminal's pipes open, and the test never ends.
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a; public long b; public uint LimitFlags; public UIntPtr c; public UIntPtr d; public uint e; public UIntPtr f; public uint g; public uint h; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC Basic; public IO Io; public UIntPtr p1, p2, p3, p4; }
  [DllImport("kernel32.dll")] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr j, int c, ref EXT i, uint l);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);

  // One argument as CommandLineToArgvW reads it back (quotes, and the backslashes before them).
  static string Q(string s) {
    if (s.Length > 0 && s.IndexOfAny(new char[] { ' ', '\t', '\n', '\r', '"' }) < 0) return s;
    var sb = new StringBuilder("\"");
    int bs = 0;
    foreach (char c in s) {
      if (c == '\\') { bs++; continue; }
      if (c == '"') { sb.Append('\\', bs * 2 + 1); sb.Append('"'); bs = 0; continue; }
      sb.Append('\\', bs); bs = 0; sb.Append(c);
    }
    sb.Append('\\', bs * 2); sb.Append('"');
    return sb.ToString();
  }

  static int Main(string[] args) {
    string exe = Process.GetCurrentProcess().MainModule.FileName;
    string script = Path.Combine(Path.GetDirectoryName(exe), Path.GetFileNameWithoutExtension(exe));
    string node = Environment.GetEnvironmentVariable("TEST_SHIM_NODE");
    if (string.IsNullOrEmpty(node)) node = "node";
    var line = new StringBuilder(Q(script));
    foreach (var a in args) { line.Append(' '); line.Append(Q(a)); }
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    var info = new EXT();
    info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    SetInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(typeof(EXT))); // JobObjectExtendedLimitInformation
    var psi = new ProcessStartInfo(node, line.ToString());
    psi.UseShellExecute = false;
    var p = Process.Start(psi);
    AssignProcessToJobObject(job, p.Handle);
    p.WaitForExit();
    return p.ExitCode;
  }
}
