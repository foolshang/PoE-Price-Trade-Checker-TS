using System;
using System.Windows.Forms;
public static class StandInGame {
  [STAThread] public static void Main(string[] a) {
    var f = new Form();
    f.Text = a.Length > 0 ? a[0] : "Path of Exile";
    f.Width = 500; f.Height = 300; f.StartPosition = FormStartPosition.CenterScreen;
    Application.Run(f);
  }
}
