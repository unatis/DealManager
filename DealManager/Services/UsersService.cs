using DealManager.Models;
using MongoDB.Driver;

namespace DealManager.Services
{
    public class UsersService
    {
        private readonly IMongoCollection<AppUser> _users;

        public UsersService(MongoSettings settings)
        {
            var clientSettings = MongoClientSettings.FromConnectionString(settings.ConnectionString);
            clientSettings.AllowInsecureTls = true;            
            var client = new MongoClient(clientSettings);

            var db = client.GetDatabase(settings.Database);
            _users = db.GetCollection<AppUser>("users");
        }

        public Task<AppUser?> GetByEmailAsync(string email) =>
            _users.Find(u => u.Email == email).FirstOrDefaultAsync();

        public Task CreateAsync(AppUser user) =>
            _users.InsertOneAsync(user);

        public Task UpdatePortfolioAsync(string userId, double portfolio) =>
            _users.UpdateOneAsync(
                u => u.Id == userId,
                Builders<AppUser>.Update.Set(u => u.Portfolio, portfolio));
    }
}
