namespace DealManager.Models;

public class WeeklyCandle
{
    public DateTime Date { get; set; }   // дата недели (обычно дата закрытия недели)
    public decimal Open { get; set; }
    public decimal High { get; set; }
    public decimal Low { get; set; }
    public decimal Close { get; set; }
}






