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
        public Task<List<Deal>> GetAllForOwnerAsync(string ownerId) =>
            _deals.Find(d => d.OwnerId == ownerId).ToListAsync();

        // все сделки конкретного пользователя
        public Task<List<Deal>> GetByUserAsync(string userId) =>
            _deals.Find(d => d.UserId == userId).ToListAsync();

        // одна сделка по id + userId
        public Task<Deal?> GetAsync(string id, string userId) =>
            _deals.Find(d => d.Id == id && d.UserId == userId)
                  .FirstOrDefaultAsync();

        public Task CreateAsync(Deal deal) =>
            _deals.InsertOneAsync(deal);

        // возвращаем bool чтобы контроллер мог понять, было ли изменение
        public async Task<bool> UpdateAsync(string id, string userId, Deal deal)
        {
            deal.Id = id;
            deal.UserId = userId;

            var result = await _deals.ReplaceOneAsync(
                d => d.Id == id && d.UserId == userId,
                deal);

            return result.ModifiedCount == 1;
        }

        public async Task<bool> DeleteAsync(string id, string userId)
        {
            var result = await _deals.DeleteOneAsync(
                d => d.Id == id && d.UserId == userId);

            return result.DeletedCount == 1;
        }
    }
}
