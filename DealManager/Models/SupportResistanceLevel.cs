namespace DealManager.Models
{
    public class SupportResistanceLevel
    {
        /// <summary>Цена уровня (горизонтальная линия).</summary>
        public decimal Level { get; set; }

        /// <summary>Нижняя граница кластера цен, из которого получен уровень.</summary>
        public decimal LowBound { get; set; }

        /// <summary>Верхняя граница кластера цен.</summary>
        public decimal HighBound { get; set; }

        /// <summary>Сколько раз high попадал в этот диапазон.</summary>
        public int HighTouches { get; set; }

        /// <summary>Сколько раз low попадал в этот диапазон.</summary>
        public int LowTouches { get; set; }

        /// <summary>Первая дата касания уровня.</summary>
        public DateTime? FirstTouch { get; set; }

        /// <summary>Последняя дата касания уровня.</summary>
        public DateTime? LastTouch { get; set; }

        /// <summary>Общее количество касаний (high + low).</summary>
        public int TotalTouches => HighTouches + LowTouches;
    }
}
