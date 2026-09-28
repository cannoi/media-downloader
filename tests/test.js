const chai = require('chai');
const chaiHttp = require('chai-http');
const server = require('../server');

chai.use(chaiHttp);
const expect = chai.expect;

describe('Media Downloader', () => {
  it('should return health status', (done) => {
    chai.request(server)
      .get('/health')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.text).to.equal('OK');
        done();
      });
  });

  it('should download media', (done) => {
    chai.request(server)
      .post('/download')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', category: 'test' })
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body).to.have.property('message').that.includes('Download completed');
        done();
      });
  });

  it('should fetch media list', (done) => {
    chai.request(server)
      .get('/media')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('array');
        done();
      });
  });
});