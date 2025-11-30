using DealManager.Models;
using MongoDB.Driver;

namespace DealManager.Services
{
    public class DealsService
    {
        private readonly IMongoCollection<Deal> _deals;

        public DealsService(MongoSettings settings)
        {
            var client = new MongoClient(settings.ConnectionString);
            var db = client.GetDatabase(settings.Database);
            _deals = db.GetCollection<Deal>(settings.DealsCollection);
        }

        public async Task<List<Deal>> GetAllAsync() =>
            await _deals.Find(_ => true).ToListAsync();

        public async Task<Deal?> GetAsync(string id) =>
            await _deals.Find(d => d.Id == id).FirstOrDefaultAsync();

        public async Task CreateAsync(Deal deal) =>
            await _deals.InsertOneAsync(deal);

        public async Task UpdateAsync(string id, Deal deal) =>
            await _deals.ReplaceOneAsync(d => d.Id == id, deal);

        public async Task DeleteAsync(string id) =>
            await _deals.DeleteOneAsync(d => d.Id == id);
    }
}
