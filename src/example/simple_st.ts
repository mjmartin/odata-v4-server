import { Edm, odata, ODataController, ODataServer, ODataQuery } from "../lib";

class ServiceTicket {

  @Edm.Key
  @Edm.Int16
  ID: number;

  @Edm.String
  @Edm.MaxLength(50)
  Title: string;

  @Edm.String
  @Edm.MaxLength(10240)
  Description: string;

}

@odata.type(ServiceTicket)
@odata.entitySet("Tickets")
class ServiceTicketController extends ODataController {

}

@odata.namespace('default')
@odata.withController(ServiceTicketController, true)
class Server extends ODataServer {

  @odata.GET
  find(@odata.filter filter: ODataQuery) {
    // build query
    return []
  }

};

// start server
Server.create("/odata", 3000)